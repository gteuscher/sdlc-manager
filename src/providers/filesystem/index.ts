/**
 * T027 — the filesystem provider: the offline path.
 *
 * This adapter reads markdown artifacts, file-derived state, file-derived item
 * discovery, and file-recorded check results from a repository on disk. It opens
 * no socket, holds no credential, and imports nothing that could reach a network,
 * which is what makes FR-036 and constitution Principle I hold: with every remote
 * provider absent or unreachable, a lifecycle declared entirely over the
 * filesystem still resolves.
 *
 * It serves two declared kinds — `filesystem` and `checks` — because the
 * spec's own assumption sanctions the shape: "Automated test results reach the
 * application through a provider — a file the harness writes or a source host's
 * check results." A `checks` provider whose results are a local JSON file is the
 * first half of that sentence, and it is the only way a failed check gate can be
 * demonstrated with networking disabled. The composition root maps both kinds
 * here; nothing below branches on which one was declared, and `health()` reports
 * the declared kind verbatim, so a `checks` declaration is never unsupported.
 *
 * Two rules from contracts/provider-interface.md shape every method below:
 *
 *   Rule 1 — nothing throws for an expected failure. A missing file, a malformed
 *   document, a locator that cannot be templated: each is a typed `Result`
 *   failure, so one unreadable item leaves the rest of the dashboard intact.
 *
 *   Rule 2 — nothing here maps. `readState` returns the file's own raw string;
 *   translating it into a declared state is the engine's job, because the mapping
 *   lives in the manifest. That is why no state name appears in this file, and
 *   why `passes_when` is evaluated by `@core`'s `evaluateCondition` rather than
 *   reimplemented here — the condition is manifest data, and interpreting it is
 *   engine work this adapter merely calls into.
 */

import { watch } from 'chokidar';
import path from 'node:path';
import { z } from 'zod';

import { evaluateCondition } from '@core/engine/evaluateGate.js';
import type { ArtifactDecl, Condition, GateDecl, ProviderDecl } from '@core/model/declared.js';
import type {
  ArtifactContent,
  EvidenceRef,
  GateResult,
  GateStatus,
  ItemKey,
  ProviderHealth,
} from '@core/model/observed.js';
import type { Result } from '@core/model/result.js';
import { fail, ok } from '@core/model/result.js';

import type {
  Provider,
  ProviderOptions,
  RawItem,
  RawState,
  RepoContext,
  Unsubscribe,
} from '../contract.js';
import { notEvaluated, nowIso } from '../contract.js';
import { compileGlob, isGlob, staticPrefix } from './glob.js';
import {
  applyTemplate,
  describe,
  displayPath,
  fileExists,
  listFiles,
  readDotted,
  readJson,
  readTextCapped,
  readableDirectory,
  resolveRoot,
  resolveUnderRoot,
  toPosix,
} from './paths.js';

/** FR-021: very large artifacts are truncated rather than loaded whole. */
const MAX_ARTIFACT_BYTES = 512 * 1024;

/** Editors write a file several times in a row; one burst should be one refresh. */
const WATCH_DEBOUNCE_MS = 150;

/** Marks an item whose key came from its folder name because no pattern supplied one. */
const KEY_SOURCE_FIELD = 'keySource';

/** The object a results file keys its recorded outcomes by. */
const RESULTS_ROOT_KEY = 'checks';

/** The settings this adapter understands, in the manifest's own snake_case. */
interface FilesystemSettings {
  /** Relative to the registered repository path. Defaults to the repository itself. */
  readonly root: string;
  /** JSON file holding one item's metadata, with `{item.<field>}` templating. */
  readonly statePath: string | null;
  /** Dotted path within that JSON to the raw status value. */
  readonly stateField: string | null;
  /** Dotted path within that same JSON to the item's title. */
  readonly titleField: string | null;
  /**
   * JSON file holding the check results a harness wrote for one item, templated
   * exactly as `state.path` is. Absent means this provider records no check
   * results at all, which is not the same as recording that none passed.
   */
  readonly resultsPath: string | null;
}

export function createFilesystemProvider(options: ProviderOptions): Provider {
  const id = options.decl.id;
  const kind = options.decl.kind;
  const settings = parseSettings(options.decl);

  /**
   * `health()` carries no `RepoContext`, yet this provider's root is defined
   * relative to a repository. The last context seen is remembered so that health
   * can report the root it actually reads. Instance state, not module state: two
   * providers never share it.
   */
  let lastContext: RepoContext | null = null;

  function requireSettings(): Result<FilesystemSettings> {
    return settings;
  }

  function rootOf(ctx: RepoContext, config: FilesystemSettings): string {
    return resolveRoot(ctx.repositoryPath, config.root);
  }

  function show(config: FilesystemSettings, relative: string): string {
    return displayPath(config.root, relative);
  }

  function evidenceFor(config: FilesystemSettings, relative: string): EvidenceRef {
    return { provider: id, locator: show(config, relative) };
  }

  function decided(
    decl: GateDecl,
    status: GateStatus,
    evidence: EvidenceRef | null,
    detail: string,
    at?: string | null,
  ): GateResult {
    return {
      gateId: decl.id,
      status,
      // Null exactly when the status is not_evaluated (observed.ts, FR-014).
      // `at` is when the recorded result was produced, where a record says so;
      // otherwise this read is the only time anything is known to be true.
      evaluatedAt: status === 'not_evaluated' ? null : (at ?? nowIso(options.now)),
      evidence,
      detail,
    };
  }

  /**
   * The identity values a locator template may use when only the item key is in
   * hand. `key` is always available, and the manifest's correlation field is
   * bound to the same value because that is what the key *is*.
   */
  function valuesForKey(ctx: RepoContext, key: ItemKey): Record<string, string> {
    const values: Record<string, string> = { key };
    const correlateOn = ctx.definition.items.identity.correlateOn;
    if (typeof correlateOn === 'string' && correlateOn !== '') values[correlateOn] = key;
    return values;
  }

  /** Templates a locator and resolves it under the root, in one step. */
  function locate(
    ctx: RepoContext,
    config: FilesystemSettings,
    template: string,
    values: Readonly<Record<string, string>>,
  ): Result<{ relative: string; absolute: string; display: string }> {
    const templated = applyTemplate(template, values);
    if (!templated.ok) return templated;
    const relative = toPosix(templated.value);
    const absolute = resolveUnderRoot(rootOf(ctx, config), relative);
    if (!absolute.ok) return absolute;
    return ok({ relative, absolute: absolute.value, display: show(config, relative) });
  }

  /**
   * The first file matching a locator, or `null` when nothing matches.
   *
   * A locator may be a literal path or a glob — the worked example in
   * sdlc-manifest.md §7 uses `escalations/*.open.json` — so both are resolved the
   * same way and the caller sees only a path or its absence.
   */
  async function findMatch(
    rootAbsolute: string,
    relative: string,
  ): Promise<Result<string | null>> {
    if (!isGlob(relative)) {
      const absolute = resolveUnderRoot(rootAbsolute, relative);
      if (!absolute.ok) return absolute;
      return ok((await fileExists(absolute.value)) ? relative : null);
    }
    const listed = await listFiles(rootAbsolute, staticPrefix(relative));
    if (!listed.ok) return listed;
    const pattern = compileGlob(relative);
    const match = listed.value.find((candidate) => pattern.test(candidate));
    return ok(match ?? null);
  }

  async function readJsonAt(
    ctx: RepoContext,
    config: FilesystemSettings,
    template: string,
    values: Readonly<Record<string, string>>,
  ): Promise<Result<{ json: unknown; display: string }>> {
    const located = locate(ctx, config, template, values);
    if (!located.ok) return located;
    const json = await readJson(located.value.absolute, located.value.display);
    if (!json.ok) return json;
    return ok({ json: json.value, display: located.value.display });
  }

  return {
    id,
    kind,

    async health(): Promise<ProviderHealth> {
      const checkedAt = nowIso(options.now);
      if (!settings.ok) {
        // Not `not_configured`: nothing is missing that an engineer could supply
        // at runtime. The manifest's declaration is what this adapter cannot use.
        return { providerId: id, kind, status: 'unsupported', message: settings.message, checkedAt };
      }
      const context = lastContext;
      if (context === null) {
        // A filesystem provider needs no credential, which is exactly what makes
        // FR-036 hold; there is nothing to be unconfigured about. Its root is
        // resolved per repository, and none has been read yet.
        return {
          providerId: id,
          kind,
          status: 'ok',
          message: `${id} reads the local filesystem and needs no credential; its root '${settings.value.root}' is resolved against each repository as that repository is read.`,
          checkedAt,
        };
      }
      const rootAbsolute = rootOf(context, settings.value);
      const readable = await readableDirectory(rootAbsolute, toPosix(rootAbsolute));
      if (!readable.ok) {
        return { providerId: id, kind, status: 'unreachable', message: readable.message, checkedAt };
      }
      return {
        providerId: id,
        kind,
        status: 'ok',
        message: `${id} is reading ${toPosix(rootAbsolute)}.`,
        checkedAt,
      };
    },

    async discoverItems(ctx: RepoContext): Promise<Result<RawItem[]>> {
      lastContext = ctx;
      const config = requireSettings();
      if (!config.ok) return config;

      const rules = ctx.definition.items.discover.filter(
        (rule) => rule.provider === id && typeof rule.glob === 'string' && rule.glob !== '',
      );
      // Nothing declares this provider as a source of items. That is not a
      // failure — a lifecycle may use the filesystem only for artifacts.
      if (rules.length === 0) return ok([]);

      const rootAbsolute = rootOf(ctx, config.value);
      const readable = await readableDirectory(rootAbsolute, toPosix(rootAbsolute));
      if (!readable.ok) return readable;

      const patternSource = ctx.definition.items.identity.patterns[id];
      let identity: RegExp | null = null;
      if (typeof patternSource === 'string' && patternSource !== '') {
        try {
          identity = new RegExp(patternSource);
        } catch (error) {
          return fail(
            'invalid_input',
            `The identity pattern declared for '${id}' is not a valid regular expression: ${describe(error)}`,
            { field: `items.identity.patterns.${id}` },
          );
        }
      }

      const matched: string[] = [];
      const seen = new Set<string>();
      for (const rule of rules) {
        const glob = rule.glob ?? '';
        const listed = await listFiles(rootAbsolute, staticPrefix(glob));
        if (!listed.ok) return listed;
        const pattern = compileGlob(glob);
        for (const candidate of listed.value) {
          // An item qualifying under more than one rule is listed once
          // (sdlc-manifest.md §3).
          if (!pattern.test(candidate) || seen.has(candidate)) continue;
          seen.add(candidate);
          matched.push(candidate);
        }
      }

      const correlateOn = ctx.definition.items.identity.correlateOn;
      const items = new Map<string, RawItem>();
      for (const relative of matched) {
        const fields: Record<string, string> = extractFields(identity, relative);
        let key = correlateOn === '' ? undefined : fields[correlateOn];
        if (key === undefined || key === '') {
          key = containingName(relative, rootAbsolute, ctx.repositoryId);
          if (correlateOn !== '') fields[correlateOn] = key;
          // Say so, rather than presenting a guessed key as an extracted one.
          fields[KEY_SOURCE_FIELD] = 'containing-directory';
        }
        if (items.has(key)) continue;
        fields['key'] = fields['key'] ?? key;

        const item: {
          -readonly [K in keyof RawItem]: RawItem[K];
        } = { key, source: id, fields };

        if (config.value.statePath !== null) {
          const read = await readJsonAt(ctx, config.value, config.value.statePath, fields);
          if (read.ok) {
            // Discovery reports what it can read. An item whose metadata is
            // missing or malformed is still an item; `readState` is where that
            // becomes a reportable failure (Principle III).
            if (config.value.stateField !== null) {
              const raw = readDotted(read.value.json, config.value.stateField);
              if (raw !== undefined && raw !== null) item.rawState = String(raw);
            }
            if (config.value.titleField !== null) {
              const title = readDotted(read.value.json, config.value.titleField);
              if (title !== undefined && title !== null) item.title = String(title);
            }
          }
        }
        items.set(key, item);
      }

      return ok([...items.values()]);
    },

    async readState(ctx: RepoContext, key: ItemKey): Promise<Result<RawState>> {
      lastContext = ctx;
      const config = requireSettings();
      if (!config.ok) return config;
      const { statePath, stateField } = config.value;
      if (statePath === null || stateField === null) {
        return fail(
          'invalid_input',
          `The '${id}' provider owns state but declares no 'state.path' and 'state.field'; there is nothing to read a status from.`,
          { field: `providers.${id}.state` },
        );
      }

      const read = await readJsonAt(ctx, config.value, statePath, valuesForKey(ctx, key));
      if (!read.ok) return read;
      const raw = readDotted(read.value.json, stateField);
      if (raw === undefined || raw === null) {
        return fail(
          'not_found',
          `${read.value.display} has no '${stateField}' value for ${key}.`,
          { field: stateField },
        );
      }
      // The file's own vocabulary, unmapped. Translating it is the engine's job
      // (provider-interface.md rule 2).
      return ok({ value: String(raw), observedAt: nowIso(options.now) });
    },

    async readArtifact(
      ctx: RepoContext,
      decl: ArtifactDecl,
      key: ItemKey,
    ): Promise<Result<ArtifactContent>> {
      lastContext = ctx;
      const config = requireSettings();
      if (!config.ok) return config;

      if (decl.kind === 'tracker') {
        return fail(
          'unavailable',
          `The '${decl.id}' artifact is a tracker artifact, and a filesystem has no issue tracker. Declare it on a tracker provider instead.`,
          { field: `artifacts.${decl.id}.kind` },
        );
      }

      const template = decl.locator.path;
      if (template === undefined || template === '') {
        return fail(
          'invalid_input',
          `The '${decl.id}' artifact declares no 'path', so this provider has nothing to read.`,
          { field: `artifacts.${decl.id}.path` },
        );
      }

      const located = locate(ctx, config.value, template, valuesForKey(ctx, key));
      if (!located.ok) return located;

      const rootAbsolute = rootOf(ctx, config.value);
      const match = await findMatch(rootAbsolute, located.value.relative);
      if (!match.ok) return match;
      if (match.value === null) {
        return fail('not_found', `${located.value.display} does not exist.`);
      }

      const absolute = resolveUnderRoot(rootAbsolute, match.value);
      if (!absolute.ok) return absolute;
      const display = show(config.value, match.value);
      const read = await readTextCapped(absolute.value, display, MAX_ARTIFACT_BYTES);
      if (!read.ok) return read;

      if (decl.kind === 'test-results' && !read.value.truncated) {
        // Validated at the boundary (rule 3), but returned as text: the renderer
        // parses it. A provider never returns markup (ipc-surface.md rule 6).
        try {
          JSON.parse(read.value.text);
        } catch (error) {
          return fail('invalid_response', `${display} is not valid JSON: ${describe(error)}`);
        }
      }

      return ok({
        artifactId: decl.id,
        kind: decl.kind,
        provider: id,
        locator: display,
        content: read.value.text,
        reconciledAt: nowIso(options.now),
        truncated: read.value.truncated,
        byteLength: read.value.byteLength,
      });
    },

    async readGate(ctx: RepoContext, decl: GateDecl, key: ItemKey): Promise<Result<GateResult>> {
      lastContext = ctx;
      const config = requireSettings();
      if (!config.ok) return config;
      const values = valuesForKey(ctx, key);

      switch (decl.kind) {
        case 'check': {
          const name = decl.locator?.check;
          if (name === undefined || name === '') {
            return fail('invalid_input', `The '${decl.id}' gate names no check to read.`, {
              field: `gates.${decl.id}.check`,
            });
          }
          const template = config.value.resultsPath;
          if (template === null) {
            // Absence is never success (rule 5). Without a results file this
            // adapter records no check outcomes, and inventing one is a guess.
            return ok(
              notEvaluated(
                decl.id,
                `The '${id}' provider declares no 'results.path', so it records no result for the '${name}' check. Point it at the file the harness writes, or declare this gate on the provider that runs the check.`,
              ),
            );
          }

          const located = locate(ctx, config.value, template, values);
          if (!located.ok) return located;
          const evidence = evidenceFor(config.value, located.value.relative);

          const read = await readJson(located.value.absolute, located.value.display);
          if (!read.ok) {
            // A check that has not run is not a check that passed, and it is not
            // a failure either.
            if (read.reason === 'not_found') {
              return ok(
                decided(
                  decl,
                  'not_evaluated',
                  evidence,
                  `No result has been recorded for '${name}': ${located.value.display} does not exist.`,
                ),
              );
            }
            return read;
          }

          const entry = checkEntry(read.value, name);
          if (entry === null) {
            return ok(
              decided(
                decl,
                'not_evaluated',
                evidence,
                `${located.value.display} records no result for the '${name}' check.`,
              ),
            );
          }

          const recorded = entry['status'];
          const status = checkOutcome(recorded);
          const summary = entry['summary'];
          const detail =
            typeof summary === 'string' && summary !== ''
              ? summary
              : status === 'not_evaluated'
                ? `${located.value.display} records '${name}' as ${JSON.stringify(recorded)}, which is not a completed outcome.`
                : `${located.value.display} records '${name}' as ${JSON.stringify(recorded)}.`;
          return ok(decided(decl, status, evidence, detail, completedAt(entry['completed_at'])));
        }

        case 'artifact': {
          const template = decl.locator?.path;
          if (template === undefined || template === '') {
            return fail(
              'invalid_input',
              `The '${decl.id}' gate declares no 'path' to look for.`,
              { field: `gates.${decl.id}.path` },
            );
          }
          const located = locate(ctx, config.value, template, values);
          if (!located.ok) return located;
          const match = await findMatch(rootOf(ctx, config.value), located.value.relative);
          if (!match.ok) return match;

          // The observed value is the matched path, or null when nothing matched;
          // `passes_when: { absent: true }` is therefore expressible.
          const observed = match.value === null ? null : show(config.value, match.value);
          const passed = evaluateCondition(decl.passesWhen, observed);
          const evidence =
            match.value === null
              ? evidenceFor(config.value, located.value.relative)
              : evidenceFor(config.value, match.value);
          const found =
            observed === null
              ? `nothing matched '${located.value.display}'`
              : `'${observed}' matched '${located.value.display}'`;
          return ok(
            decided(
              decl,
              passed ? 'passed' : 'failed',
              evidence,
              `${capitalise(found)}; ${conditionText(decl.passesWhen)}.`,
            ),
          );
        }

        case 'field': {
          const template = decl.locator?.path ?? config.value.statePath;
          const field = decl.locator?.field;
          if (template === null || template === undefined || template === '') {
            return fail(
              'invalid_input',
              `The '${decl.id}' gate declares no 'path', and the '${id}' provider declares no 'state.path' to fall back to.`,
              { field: `gates.${decl.id}.path` },
            );
          }
          if (field === undefined || field === '') {
            return fail('invalid_input', `The '${decl.id}' gate declares no 'field' to read.`, {
              field: `gates.${decl.id}.field`,
            });
          }
          const read = await readJsonAt(ctx, config.value, template, values);
          if (!read.ok) return read;
          // An absent field is a legitimate observation here — `absent: true` is a
          // declarable condition — so it is passed to the engine, not refused.
          const observed = readDotted(read.value.json, field);
          const passed = evaluateCondition(decl.passesWhen, observed);
          const templated = locate(ctx, config.value, template, values);
          const evidence: EvidenceRef = {
            provider: id,
            locator: templated.ok ? templated.value.display : read.value.display,
          };
          return ok(
            decided(
              decl,
              passed ? 'passed' : 'failed',
              evidence,
              `${read.value.display} has ${field} = ${JSON.stringify(observed) ?? 'undefined'}; ${conditionText(decl.passesWhen)}.`,
            ),
          );
        }

        case 'manual': {
          const template = decl.evidence?.path ?? config.value.statePath;
          const field = decl.evidence?.field;
          if (template === null || template === undefined || template === '') {
            return fail(
              'invalid_input',
              `The '${decl.id}' gate declares no 'evidence.path', and the '${id}' provider declares no 'state.path' to fall back to. A manual gate needs somewhere to read its decision from.`,
              { field: `gates.${decl.id}.evidence.path` },
            );
          }
          if (field === undefined || field === '') {
            return fail(
              'invalid_input',
              `The '${decl.id}' gate declares no 'evidence.field', so the decision recorded for it cannot be located.`,
              { field: `gates.${decl.id}.evidence.field` },
            );
          }
          const located = locate(ctx, config.value, template, values);
          if (!located.ok) return located;
          const evidence = evidenceFor(config.value, located.value.relative);

          const read = await readJson(located.value.absolute, located.value.display);
          if (!read.ok) {
            // A decision that was never recorded is not an error — it is exactly
            // what `not_evaluated` means (rule 5). A malformed file is an error.
            if (read.reason === 'not_found') {
              return ok(
                decided(
                  decl,
                  'not_evaluated',
                  evidence,
                  `No decision has been recorded: ${located.value.display} does not exist.`,
                ),
              );
            }
            return read;
          }

          const observed = readDotted(read.value, field);
          if (observed === undefined || observed === null) {
            return ok(
              decided(
                decl,
                'not_evaluated',
                evidence,
                `No decision has been recorded: ${located.value.display} has no '${field}' value.`,
              ),
            );
          }
          const passed =
            decl.passesWhen === undefined
              ? Boolean(observed)
              : evaluateCondition(decl.passesWhen, observed);
          return ok(
            decided(
              decl,
              passed ? 'passed' : 'failed',
              evidence,
              `${located.value.display} records ${field} = ${JSON.stringify(observed)}; ${conditionText(decl.passesWhen)}.`,
            ),
          );
        }

        default:
          return fail(
            'unavailable',
            `The '${decl.id}' gate is of a kind the '${id}' provider cannot read.`,
            { field: `gates.${decl.id}.kind` },
          );
      }
    },

    subscribe(ctx: RepoContext, onChange: () => void): Unsubscribe {
      lastContext = ctx;
      if (!settings.ok) return () => undefined;
      const rootAbsolute = rootOf(ctx, settings.value);

      let timer: ReturnType<typeof setTimeout> | null = null;
      let closed = false;
      const schedule = (): void => {
        if (closed) return;
        if (timer !== null) clearTimeout(timer);
        // An editor writes a file several times in a row; one burst of writes
        // should cost one reconciliation, not five.
        timer = setTimeout(() => {
          timer = null;
          if (!closed) onChange();
        }, WATCH_DEBOUNCE_MS);
      };

      let watcher: ReturnType<typeof watch> | null = null;
      try {
        watcher = watch(rootAbsolute, {
          ignoreInitial: true,
          ignored: (candidate: string): boolean =>
            /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(candidate),
        });
        watcher.on('all', schedule);
        // A watch error must not escape as an exception (rule 1); the next read
        // reports the unreadable path with its reason.
        watcher.on('error', () => undefined);
      } catch {
        watcher = null;
      }

      return () => {
        closed = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (watcher !== null) void watcher.close().catch(() => undefined);
      };
    },
  };
}

/**
 * Validates this adapter's settings, at the boundary and in the adapter.
 *
 * sdlc-manifest.md §3 puts provider-specific settings here on purpose: core must
 * not know what a filesystem provider needs. An ill-formed declaration is
 * reported by name through `health()` and through every `Result` this provider
 * returns — never by throwing.
 */
function parseSettings(decl: ProviderDecl): Result<FilesystemSettings> {
  const schema = z.object({
    root: z.string().min(1).optional(),
    state: z
      .object({
        path: z.string().min(1),
        field: z.string().min(1),
      })
      .optional(),
    title_field: z.string().min(1).optional(),
    results: z
      .object({
        path: z.string().min(1),
      })
      .optional(),
  });

  const parsed = schema.safeParse(decl.settings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = (issue?.path ?? []).join('.');
    return fail(
      'invalid_input',
      `The '${decl.id}' filesystem provider has an ill-formed setting${where === '' ? '' : ` at '${where}'`}: ${issue?.message ?? 'it does not match the expected shape'}.`,
      { field: where === '' ? `providers.${decl.id}` : `providers.${decl.id}.${where}` },
    );
  }

  return ok({
    root: parsed.data.root ?? '.',
    statePath: parsed.data.state?.path ?? null,
    stateField: parsed.data.state?.field ?? null,
    titleField: parsed.data.title_field ?? null,
    resultsPath: parsed.data.results?.path ?? null,
  });
}

/** The recorded entry for one named check, or null when nothing is recorded for it. */
function checkEntry(document: unknown, name: string): Record<string, unknown> | null {
  const recorded = readDotted(document, RESULTS_ROOT_KEY);
  if (recorded === null || typeof recorded !== 'object') return null;
  // Indexed directly rather than by dotted path: a check name may contain dots.
  const entry = (recorded as Record<string, unknown>)[name];
  if (entry === null || entry === undefined || typeof entry !== 'object') return null;
  return entry as Record<string, unknown>;
}

/**
 * A recorded outcome to the three-value gate contract.
 *
 * This is not the mapping rule 2 forbids: that one is raw value to *declared
 * state*, and it lives in the manifest. Every provider has to produce
 * `passed | failed | not_evaluated`, because those three are the contract's own
 * vocabulary rather than any lifecycle's. Anything unrecognised — queued,
 * running, neutral, skipped, or a shape that is not a string at all — is
 * `not_evaluated`: a check that has not finished is neither a pass nor a failure
 * (FR-014, rule 5).
 */
function checkOutcome(recorded: unknown): GateStatus {
  if (typeof recorded !== 'string') return 'not_evaluated';
  const normalised = recorded.trim().toLowerCase();
  if (normalised === 'passed' || normalised === 'success') return 'passed';
  if (
    normalised === 'failed' ||
    normalised === 'failure' ||
    normalised === 'timed_out' ||
    normalised === 'cancelled'
  ) {
    return 'failed';
  }
  return 'not_evaluated';
}

/** When the harness says the check finished. Null when it does not say, or says nonsense. */
function completedAt(recorded: unknown): string | null {
  if (typeof recorded !== 'string' || recorded === '') return null;
  const parsed = Date.parse(recorded);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function extractFields(pattern: RegExp | null, relative: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (pattern === null) return fields;
  const match = pattern.exec(relative);
  if (match === null || match.groups === undefined) return fields;
  for (const [name, value] of Object.entries(match.groups)) {
    if (typeof value === 'string' && value !== '') fields[name] = value;
  }
  return fields;
}

/** The folder an item's file sits in — the fallback key when no pattern supplies one. */
function containingName(relative: string, rootAbsolute: string, fallback: string): string {
  const parent = path.posix.dirname(relative);
  if (parent !== '' && parent !== '.' && parent !== '/') {
    const name = path.posix.basename(parent);
    if (name !== '') return name;
  }
  const rootName = path.basename(rootAbsolute);
  return rootName === '' ? fallback : rootName;
}

function conditionText(condition: Condition | undefined): string {
  return condition === undefined
    ? 'the gate declares no passes_when condition'
    : `passes_when ${JSON.stringify(condition)}`;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}
