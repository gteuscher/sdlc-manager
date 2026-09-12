/**
 * T017, T021 — reading `sdlc.yaml` into the declared model.
 *
 * Uses the `yaml` package rather than `js-yaml` because it retains source
 * positions: an SDLC author debugging a lifecycle they wrote by hand gets a line
 * number, not only a field path (research.md §5).
 *
 * The order here matters and is not arbitrary:
 *
 *   1. Parse YAML. A syntax error stops everything.
 *   2. Check the contract version, and refuse an unsupported major *before*
 *      running the schema (T021, FR-047). A manifest written against a contract
 *      we do not know must be refused naming the version found, rather than run
 *      through a schema that may misread it.
 *   3. Shape validation (schema.ts).
 *   4. Cross-field validation (validate.ts).
 *   5. Map to the declared model.
 *
 * Nothing is returned unless every step passes: a malformed manifest is never
 * partially loaded (FR-044).
 */

import { LineCounter, parseDocument, type Document } from 'yaml';
import type { ZodIssue } from 'zod';

import type {
  ArtifactDecl,
  Condition,
  ConfigField,
  GateDecl,
  ItemDiscovery,
  Locator,
  ManifestProblem,
  Ownership,
  ProviderDecl,
  SdlcDefinition,
  State,
  Transition,
  WriteBackPolicy,
} from '../model/declared.js';
import { manifestSchema, type RawArtifact, type RawGate, type RawManifest } from './schema.js';
import { declaredIdentityFields, validateManifest } from './validate.js';

/** The manifest contract major version this reader understands (sdlc-manifest.md §6). */
export const SUPPORTED_CONTRACT_VERSION = 1;

export interface ParsedManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly contractVersion: number;
  readonly description?: string;
  readonly definition: SdlcDefinition;
}

export type ManifestReadResult =
  | { readonly ok: true; readonly value: ParsedManifest }
  | { readonly ok: false; readonly problems: readonly ManifestProblem[] };

/** Resolves a dot-joined field path to a source line, where the document has one. */
function lineFor(doc: Document.Parsed, counter: LineCounter, field: string | undefined): number | undefined {
  if (field === undefined || field === '') return undefined;
  const path: (string | number)[] = field.split('.').map((segment) => {
    const asNumber = Number(segment);
    return Number.isInteger(asNumber) && segment.trim() !== '' ? asNumber : segment;
  });

  // Walk back up the path until something resolves: a missing leaf still points
  // the author at the map that should have contained it.
  for (let length = path.length; length > 0; length -= 1) {
    let node: unknown;
    try {
      node = doc.getIn(path.slice(0, length), true);
    } catch {
      node = undefined;
    }
    const range = (node as { range?: [number, number, number] } | undefined)?.range;
    if (range !== undefined) {
      const position = counter.linePos(range[0]);
      return position.line;
    }
  }
  return undefined;
}

function withLines(
  problems: readonly ManifestProblem[],
  doc: Document.Parsed,
  counter: LineCounter,
): ManifestProblem[] {
  return problems.map((problem) => {
    const line = lineFor(doc, counter, problem.field);
    return line === undefined ? problem : { ...problem, line };
  });
}

function issueToProblem(issue: ZodIssue): ManifestProblem {
  const field = issue.path.join('.');
  return field === '' ? { message: issue.message } : { field, message: `${field}: ${issue.message}` };
}

// ── Mapping raw YAML (snake_case) to the declared model (camelCase) ──────────

function toCondition(raw: Record<string, unknown>): Condition | undefined {
  if ('equals' in raw) return { equals: raw['equals'] };
  if ('not_equals' in raw) return { notEquals: raw['not_equals'] };
  if ('one_of' in raw) return { oneOf: (raw['one_of'] ?? []) as readonly unknown[] };
  if ('matches' in raw) return { matches: String(raw['matches']) };
  if ('present' in raw) return { present: true };
  if ('absent' in raw) return { absent: true };
  return undefined;
}

function toLocator(source: {
  provider?: string;
  path?: string;
  field?: string;
  run?: string;
  check?: string;
}): Locator {
  const locator: Record<string, string> = {};
  if (source.provider !== undefined) locator['provider'] = source.provider;
  if (source.path !== undefined) locator['path'] = source.path;
  if (source.field !== undefined) locator['field'] = source.field;
  if (source.run !== undefined) locator['run'] = source.run;
  if (source.check !== undefined) locator['check'] = source.check;
  return locator as Locator;
}

function toArtifact(raw: RawArtifact): ArtifactDecl {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    kind: raw.kind,
    provider: raw.provider,
    locator: toLocator({ provider: raw.provider, path: raw.path, field: raw.field, run: raw.run }),
    required: raw.required ?? false,
  };
}

function toGate(raw: RawGate): GateDecl {
  const gate: {
    -readonly [K in keyof GateDecl]: GateDecl[K];
  } = {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    blocking: raw.blocking ?? true,
    awaitsHuman: raw.awaits_human ?? false,
    configurable: raw.configurable ?? false,
    locator: toLocator({
      provider: raw.provider,
      path: raw.path,
      field: raw.field,
      run: raw.run,
      check: raw.check,
    }),
  };
  if (raw.provider !== undefined) gate.provider = raw.provider;
  if (raw.evidence !== undefined) gate.evidence = toLocator(raw.evidence);
  if (raw.passes_when !== undefined) {
    const condition = toCondition(raw.passes_when);
    if (condition !== undefined) gate.passesWhen = condition;
  }
  return gate;
}

function toStates(raw: RawManifest): State[] {
  return raw.states.map((state, index) => {
    const mapped: { -readonly [K in keyof State]: State[K] } = {
      id: state.id,
      name: state.name,
      awaitsHuman: state.awaits_human ?? false,
      terminal: state.terminal ?? false,
      maps: state.maps ?? {},
      artifacts: (state.artifacts ?? []).map(toArtifact),
      gates: (state.gates ?? []).map(toGate),
      // Array position is the only ordering source. Order alone defines a linear
      // lifecycle (sdlc-manifest.md §2 rule 2).
      ordinal: index,
    };
    if (state.description !== undefined) mapped.description = state.description;
    return mapped;
  });
}

function toTransitions(raw: RawManifest): Transition[] {
  return (raw.transitions ?? []).map((transition) => {
    const mapped: { -readonly [K in keyof Transition]: Transition[K] } = {
      from: transition.from,
      to: transition.to,
      requires: transition.requires ?? [],
    };
    if (transition.name !== undefined) mapped.name = transition.name;
    return mapped;
  });
}

function toProviders(raw: RawManifest): ProviderDecl[] {
  return raw.providers.map((provider) => {
    const { id, kind, ...settings } = provider as Record<string, unknown> & { id: string; kind: string };
    return { id, kind, settings };
  });
}

function toItems(raw: RawManifest): ItemDiscovery {
  return {
    // The engineer's own noun for one work item (research.md §16 Q2).
    unit: raw.items.unit ?? 'item',
    discover: raw.items.discover.map((rule) => {
      const mapped: { provider: string; query?: string; glob?: string } = { provider: rule.provider };
      if (rule.query !== undefined) mapped.query = rule.query;
      if (rule.glob !== undefined) mapped.glob = rule.glob;
      return mapped;
    }),
    identity: {
      correlateOn: raw.items.identity.correlate_on,
      patterns: raw.items.identity.patterns ?? {},
      fields: declaredIdentityFields(raw),
    },
  };
}

function toWriteBack(raw: RawManifest): WriteBackPolicy {
  // Every flag defaults false. A package must opt in explicitly before anything
  // is written to a system of record (sdlc-manifest.md §2 rule 5, FR-033).
  const writeBack = raw.write_back;
  return {
    transitions: writeBack?.transitions ?? false,
    gateResults: writeBack?.gate_results ?? false,
    records: writeBack?.records ?? null,
  };
}

function toRepoConfig(raw: RawManifest): ConfigField[] {
  return (raw.repo_config ?? []).map((field) => {
    const mapped: { -readonly [K in keyof ConfigField]: ConfigField[K] } = {
      key: field.key,
      title: field.title,
      type: field.type,
      required: field.required ?? false,
    };
    if (field.default !== undefined) mapped.default = field.default;
    if (field.description !== undefined) mapped.description = field.description;
    return mapped;
  });
}

function toDefinition(raw: RawManifest): SdlcDefinition {
  const ownership: { -readonly [K in keyof Ownership]: Ownership[K] } = {
    state: raw.ownership.state,
    title: raw.ownership.title,
    artifacts: raw.ownership.artifacts,
  };
  if (raw.ownership.assignee !== undefined) ownership.assignee = raw.ownership.assignee;

  return {
    states: toStates(raw),
    transitions: toTransitions(raw),
    providers: toProviders(raw),
    ownership,
    items: toItems(raw),
    writeBack: toWriteBack(raw),
    repoConfig: toRepoConfig(raw),
  };
}

/**
 * Reads a manifest source. Returns every problem found at the first failing stage
 * rather than one at a time, so an author fixing a manifest is not made to
 * rediscover the next error on every run.
 */
export function readManifest(source: string): ManifestReadResult {
  const counter = new LineCounter();
  const doc = parseDocument(source, { lineCounter: counter, uniqueKeys: true });

  if (doc.errors.length > 0) {
    return {
      ok: false,
      problems: doc.errors.map((error) => ({
        message: error.message,
        ...(error.linePos?.[0] !== undefined ? { line: error.linePos[0].line } : {}),
      })),
    };
  }

  const raw: unknown = doc.toJS();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problems: [{ message: 'a manifest must be a YAML mapping at the top level' }] };
  }

  // ── Rule 1 (T021): refuse an unsupported contract version, naming what we found ──
  const declaredContract = (raw as Record<string, unknown>)['sdlc'];
  if (declaredContract === undefined) {
    return {
      ok: false,
      problems: withLines([{ field: 'sdlc', message: 'sdlc is required: the manifest must declare its contract version' }], doc, counter),
    };
  }
  if (typeof declaredContract !== 'number' || !Number.isInteger(declaredContract)) {
    return {
      ok: false,
      problems: withLines(
        [{ field: 'sdlc', message: `sdlc must be an integer contract version; found ${JSON.stringify(declaredContract)}` }],
        doc,
        counter,
      ),
    };
  }
  if (declaredContract !== SUPPORTED_CONTRACT_VERSION) {
    return {
      ok: false,
      problems: withLines(
        [
          {
            field: 'sdlc',
            message: `manifest declares contract version ${declaredContract}, which this dashboard does not support (supported: ${SUPPORTED_CONTRACT_VERSION}). Refusing to load rather than risk misreading it.`,
          },
        ],
        doc,
        counter,
      ),
    };
  }

  // ── Shape ─────────────────────────────────────────────────────────────────
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: withLines(parsed.error.issues.map(issueToProblem), doc, counter) };
  }

  // ── Cross-field ───────────────────────────────────────────────────────────
  const problems = validateManifest(parsed.data);
  if (problems.length > 0) {
    return { ok: false, problems: withLines(problems, doc, counter) };
  }

  const manifest: { -readonly [K in keyof ParsedManifest]: ParsedManifest[K] } = {
    id: parsed.data.id,
    name: parsed.data.name,
    version: parsed.data.version,
    contractVersion: parsed.data.sdlc,
    definition: toDefinition(parsed.data),
  };
  if (parsed.data.description !== undefined) manifest.description = parsed.data.description;

  return { ok: true, value: manifest };
}
