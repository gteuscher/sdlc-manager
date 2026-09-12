/**
 * T029 — the GitHub provider.
 *
 * Plain `fetch`, no vendor SDK (Principle III, FR-017). Every response is parsed
 * through `./schema.js` before it leaves this module (Principle IX), every
 * expected failure is a `Result` rather than a throw (provider-interface.md
 * rule 1), and nothing here names a lifecycle state: GitHub's own words are
 * returned raw, and the manifest's `maps` block is what turns one into a state
 * (rule 2).
 *
 * Settings (`providers[].` in `sdlc.yaml`, see sdlc-manifest.md §3):
 *
 *   owner      REQUIRED  the user or organisation
 *   repo       REQUIRED  the repository name
 *   ref        optional  the ref check runs are read for; default HEAD.
 *                        Supports {item.<field>} templating for per-item branches.
 *   api_base_url  optional, default https://api.github.com (set it for GHES)
 *   poll_seconds  optional, default 60 — remote providers poll, they do not watch
 *   timeout_ms    optional, default and ceiling 10000 (Principle X)
 *
 * The credential is a token, supplied by the composition root from
 * `safeStorage`. It is sent as `Authorization: Bearer`, never placed in a URL,
 * and never reaches a message, an error, or a log line (rule 4).
 */

import { evaluateCondition } from '@core/engine/evaluateGate.js';
import type { ArtifactDecl, GateDecl, Locator, ProviderDecl } from '@core/model/declared.js';
import type {
  ArtifactContent,
  EvidenceRef,
  GateResult,
  ItemKey,
  ProviderHealth,
  ProviderHealthStatus,
  TestRunSummary,
} from '@core/model/observed.js';
import { fail, ok } from '@core/model/result.js';
import type { Failure, FailureReason, Result } from '@core/model/result.js';
import type { ZodType } from 'zod';
import { healthy, nowIso, unconfigured } from '../contract.js';
import type {
  Provider,
  ProviderOptions,
  RawItem,
  RawState,
  RepoContext,
  Unsubscribe,
} from '../contract.js';
import {
  githubCheckRunsResponseSchema,
  githubContentsSchema,
  githubErrorSchema,
  githubIssueCommentsSchema,
  githubIssueSchema,
  githubLabelNames,
  githubRepositorySchema,
  githubSearchIssuesSchema,
  parseGithub,
} from './schema.js';
import type { GithubCheckRun, GithubIssue } from './schema.js';

const DEFAULT_API_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const DEFAULT_REF = 'HEAD';
const DEFAULT_POLL_MS = 60_000;
const MIN_POLL_MS = 5_000;
/** Principle X: ten seconds is the default ceiling for a provider-bound wait. */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 10_000;
/** FR-021: very large artifacts are truncated honestly rather than streamed. */
const MAX_ARTIFACT_BYTES = 512 * 1024;
const MAX_DISCOVERY_RESULTS = 50;
const MAX_COMMENTS = 50;
const MAX_CHECK_RUNS = 100;
const ERROR_EXCERPT_CHARS = 240;

/** A completed run with this conclusion passed its gate. */
const PASSING_CONCLUSIONS: readonly string[] = ['success'];
/** A completed run with any of these failed it. Everything else is not_evaluated. */
const FAILING_CONCLUSIONS: readonly string[] = ['failure', 'timed_out', 'cancelled'];
const SKIPPED_CONCLUSIONS: readonly string[] = ['skipped', 'neutral', 'stale'];

interface GithubConfig {
  readonly apiBaseUrl: string;
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly pollMs: number;
  readonly timeoutMs: number;
}

interface ResolvedSettings {
  readonly config: GithubConfig | null;
  readonly missing: readonly string[];
}

export function createGithubProvider(options: ProviderOptions): Provider {
  const id = options.decl.id;
  const kind = options.decl.kind;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now;
  const { config, missing } = resolveSettings(options.decl, options.credential);
  const token =
    options.credential !== undefined && options.credential !== '' ? options.credential : null;

  /** Everything that must never appear in a message, an error, or a log line (rule 4). */
  const secrets: readonly string[] = [token ?? ''].filter((secret) => secret.length >= 4);

  function scrub(text: string): string {
    let scrubbed = text;
    for (const secret of secrets) {
      scrubbed = scrubbed.split(secret).join('[redacted]');
    }
    return scrubbed;
  }

  function problem(reason: FailureReason, message: string, field?: string): Failure {
    return field === undefined
      ? fail(reason, scrub(message))
      : fail(reason, scrub(message), { field });
  }

  function notConfigured(): Failure {
    return problem(
      'not_configured',
      `The ${id} provider is not configured: ${missing.join('; ')}. ` +
        'Nothing was read; the rest of the dashboard is unaffected.',
    );
  }

  function healthReport(status: ProviderHealthStatus, message: string): ProviderHealth {
    return { providerId: id, kind, status, message: scrub(message), checkedAt: nowIso(now) };
  }

  function buildUrl(base: string, path: string, params?: Readonly<Record<string, string>>): string {
    const root = base.replace(/\/+$/, '');
    const query = new URLSearchParams(params ?? {}).toString();
    return query === '' ? `${root}${path}` : `${root}${path}?${query}`;
  }

  /**
   * One request, one schema, one `Result`. Nothing else in this file calls
   * `fetch`, so the timeout, the status mapping, and the boundary parse cannot be
   * skipped by accident.
   */
  async function request<T>(
    schema: ZodType<T>,
    what: string,
    path: string,
    params?: Readonly<Record<string, string>>,
  ): Promise<Result<T>> {
    if (config === null || token === null) return notConfigured();

    const url = buildUrl(config.apiBaseUrl, path, params);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, config.timeoutMs);

    let status = 0;
    let headers: Headers | null = null;
    let body = '';
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        // The token travels in a header, never in the URL (rule 4).
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': API_VERSION,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      status = response.status;
      headers = response.headers;
      body = await response.text();
    } catch (error) {
      const described = describeError(error);
      if (described.name === 'AbortError' || described.name === 'TimeoutError') {
        return problem(
          'unreachable',
          `Reading the ${what} from GitHub timed out after ${config.timeoutMs}ms. Retry when the API responds.`,
        );
      }
      return problem(
        'unreachable',
        `Could not reach GitHub to read the ${what}: ${described.message}. Check the network and the API base URL.`,
      );
    } finally {
      clearTimeout(timer);
    }

    const statusFailure = failureForStatus(status, headers, body, what);
    if (statusFailure !== null) return statusFailure;

    let decoded: unknown;
    try {
      decoded = body === '' ? null : (JSON.parse(body) as unknown);
    } catch {
      return problem(
        'invalid_response',
        `GitHub's ${what} response was not valid JSON. The response was discarded rather than guessed at.`,
      );
    }

    const parsed = parseGithub(schema, decoded, what);
    if (parsed.ok) return parsed;
    return problem('invalid_response', parsed.message, parsed.field);
  }

  function failureForStatus(
    status: number,
    headers: Headers | null,
    body: string,
    what: string,
  ): Failure | null {
    if (status >= 200 && status < 300) return null;
    const excerpt = errorExcerpt(body);
    const suffix = excerpt === '' ? '' : ` GitHub said: ${excerpt}`;

    // GitHub reports exhausted quota as 403 with the remaining budget at zero,
    // and secondary limits as 429.
    if (status === 429 || (status === 403 && isRateLimited(headers))) {
      const reset = headers?.get('x-ratelimit-reset') ?? headers?.get('retry-after');
      const wait = reset === null || reset === undefined ? '' : ` The limit resets at ${reset}.`;
      return problem(
        'rate_limited',
        `GitHub rate-limited the ${id} provider while reading the ${what}.${wait} The value shown may be stale until the limit clears.${suffix}`,
      );
    }
    if (status === 401) {
      return problem(
        'unauthenticated',
        `GitHub rejected the credential for ${id} while reading the ${what} (401). Update the token for this provider in Settings.${suffix}`,
      );
    }
    if (status === 403) {
      return problem(
        'unauthenticated',
        `The token for ${id} is not permitted to read the ${what} (403). Grant it access to the repository, or use a token with wider scope.${suffix}`,
      );
    }
    if (status === 404) {
      return problem(
        'not_found',
        `GitHub has nothing at that locator for the ${what} (404). A private repository is also reported as 404 when the token cannot see it.${suffix}`,
      );
    }
    if (status === 410) {
      return problem('not_found', `The ${what} has been removed from GitHub (410).${suffix}`);
    }
    if (status === 400 || status === 422) {
      return problem(
        'invalid_input',
        `GitHub rejected the request for the ${what} (${status}). The query or locator in the manifest is not valid for this repository.${suffix}`,
      );
    }
    if (status >= 500) {
      return problem(
        'unreachable',
        `GitHub returned ${status} while reading the ${what}. The API is unavailable; retry later.${suffix}`,
      );
    }
    return problem(
      'invalid_response',
      `GitHub returned an unexpected ${status} while reading the ${what}.${suffix}`,
    );
  }

  function errorExcerpt(body: string): string {
    if (body === '') return '';
    let decoded: unknown;
    try {
      decoded = JSON.parse(body) as unknown;
    } catch {
      return truncateText(scrub(body), ERROR_EXCERPT_CHARS);
    }
    const parsed = githubErrorSchema.safeParse(decoded);
    if (!parsed.success) return '';
    const parts = [
      ...(parsed.data.message === undefined ? [] : [parsed.data.message]),
      ...(parsed.data.errors ?? []).map((entry) =>
        [entry.field, entry.code, entry.message].filter((piece) => piece !== undefined).join(' '),
      ),
    ];
    return truncateText(scrub(parts.join('; ')), ERROR_EXCERPT_CHARS);
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  /**
   * Extracts the identity fields a locator template may reference, applying
   * `items.identity.patterns[<this provider>]` when the manifest declares one.
   * The pattern is tried against the issue URL, then `owner/repo#number`, then
   * the title — a correlation key often lives in a branch-shaped URL or a title
   * prefix rather than in the number.
   */
  function identityFor(
    ctx: RepoContext,
    candidates: readonly string[],
    fallbackKey: string,
    extra: Readonly<Record<string, string>>,
  ): { readonly key: ItemKey; readonly fields: Readonly<Record<string, string>> } {
    const identity = ctx.definition.items.identity;
    const fields: Record<string, string> = { ...extra, key: fallbackKey };
    const pattern = identity.patterns[id];
    if (pattern !== undefined && pattern !== '') {
      const regex = compileRegex(pattern);
      if (regex !== null) {
        for (const candidate of candidates) {
          const match = regex.exec(candidate);
          if (match?.groups === undefined) continue;
          for (const [name, value] of Object.entries(match.groups)) {
            if (typeof value === 'string') fields[name] = value;
          }
          break;
        }
      }
    }
    const correlateOn = identity.correlateOn;
    const correlated = correlateOn === '' ? undefined : fields[correlateOn];
    const key = correlated ?? fields['key'] ?? fallbackKey;
    if (correlateOn !== '' && fields[correlateOn] === undefined) fields[correlateOn] = key;
    return { key, fields };
  }

  /** The fields available when only an `ItemKey` is in hand. */
  function fieldsForKey(ctx: RepoContext, key: ItemKey): Readonly<Record<string, string>> {
    return identityFor(ctx, [key], key, {}).fields;
  }

  /**
   * Resolves the issue number a key refers to. A manifest whose keys are not
   * numbers declares a `(?<number>…)` group; without one the failure says so
   * rather than guessing at a number.
   */
  function issueNumberFor(ctx: RepoContext, key: ItemKey): Result<number> {
    const fields = fieldsForKey(ctx, key);
    for (const candidate of [fields['number'], fields['issue'], fields['key'], key]) {
      if (candidate === undefined) continue;
      const match = /(?:^|#|\/)(\d+)$/.exec(candidate.trim());
      const digits = match?.[1];
      if (digits !== undefined) return ok(Number(digits));
    }
    return problem(
      'invalid_input',
      `No GitHub issue number can be resolved from the item key "${key}". ` +
        `Declare items.identity.patterns.${id} with a (?<number>[0-9]+) group so the issue can be addressed.`,
      'items.identity.patterns',
    );
  }

  function template(
    value: string,
    fields: Readonly<Record<string, string>>,
    where: string,
  ): Result<string> {
    const missingField: string[] = [];
    const rendered = value.replace(/\{item\.([A-Za-z0-9_]+)\}/g, (_match, name: string) => {
      const resolved = fields[name];
      if (resolved === undefined) {
        missingField.push(name);
        return '';
      }
      return resolved;
    });
    if (missingField.length > 0) {
      return problem(
        'invalid_input',
        `The ${where} references {item.${missingField[0] ?? ''}}, which this item has no value for. ` +
          'Declare it in items.identity.fields and extract it with items.identity.patterns.',
        where,
      );
    }
    return ok(rendered);
  }

  function refFor(ctx: RepoContext, key: ItemKey): Result<string> {
    if (config === null) return notConfigured();
    if (!config.ref.includes('{item.')) return ok(config.ref);
    return template(config.ref, fieldsForKey(ctx, key), 'ref setting');
  }

  // ── Interface ─────────────────────────────────────────────────────────────

  async function health(): Promise<ProviderHealth> {
    if (config === null) return unconfigured(id, kind, missing.join('; '), now);

    const probe = await request(
      githubRepositorySchema,
      'repository',
      `/repos/${encodePath(config.owner)}/${encodePath(config.repo)}`,
    );
    if (probe.ok) return healthy(id, kind, now);
    if (probe.reason === 'not_found') {
      return healthReport(
        'unauthenticated',
        `${id} cannot see ${config.owner}/${config.repo}. Either the repository name is wrong or the token has no access to it.`,
      );
    }
    return healthReport(healthStatusFor(probe.reason), probe.message);
  }

  async function discoverItems(ctx: RepoContext): Promise<Result<RawItem[]>> {
    if (config === null) return notConfigured();

    const rules = ctx.definition.items.discover.filter((rule) => rule.provider === id);
    if (rules.length === 0) return ok([]);

    const items: RawItem[] = [];
    const seen = new Set<string>();
    for (const rule of rules) {
      if (rule.query === undefined || rule.query.trim() === '') {
        return problem(
          'invalid_input',
          `A discovery rule names ${id} but declares no query. Give the rule a GitHub search query, or remove it.`,
          'items.discover',
        );
      }
      const response = await request(githubSearchIssuesSchema, 'issue search', '/search/issues', {
        q: scopeQuery(rule.query, config.owner, config.repo),
        per_page: String(MAX_DISCOVERY_RESULTS),
      });
      if (!response.ok) return response;

      for (const issue of response.value.items) {
        const naturalKey = `${config.owner}/${config.repo}#${issue.number}`;
        const identity = identityFor(
          ctx,
          [issue.html_url, naturalKey, issue.title],
          naturalKey,
          {
            number: String(issue.number),
            owner: config.owner,
            repo: config.repo,
          },
        );
        if (seen.has(identity.key)) continue;
        seen.add(identity.key);
        items.push({
          key: identity.key,
          source: id,
          fields: identity.fields,
          title: issue.title,
          // GitHub's own vocabulary, never a declared state (rule 2).
          rawState: issue.state,
          ...(issue.assignee !== null && issue.assignee !== undefined
            ? { assignee: issue.assignee.login }
            : {}),
        });
      }
    }
    return ok(items);
  }

  async function readState(ctx: RepoContext, key: ItemKey): Promise<Result<RawState>> {
    const issue = await readIssue(ctx, key);
    if (!issue.ok) return issue;
    // Raw, exactly as GitHub words it. The engine maps it via the manifest.
    return ok({ value: issue.value.state, observedAt: nowIso(now) });
  }

  async function readIssue(ctx: RepoContext, key: ItemKey): Promise<Result<GithubIssue>> {
    if (config === null) return notConfigured();
    const number = issueNumberFor(ctx, key);
    if (!number.ok) return number;
    return request(
      githubIssueSchema,
      'issue',
      `/repos/${encodePath(config.owner)}/${encodePath(config.repo)}/issues/${number.value}`,
    );
  }

  async function readArtifact(
    ctx: RepoContext,
    decl: ArtifactDecl,
    key: ItemKey,
  ): Promise<Result<ArtifactContent>> {
    if (config === null) return notConfigured();

    if (decl.kind === 'tracker') return readTrackerArtifact(ctx, decl, key);
    if (decl.kind === 'markdown') return readMarkdownArtifact(ctx, decl, key);
    if (decl.kind === 'test-results') return readTestResultsArtifact(ctx, decl, key);
    return problem(
      'unavailable',
      `The ${id} provider cannot read artifacts of kind "${decl.kind}". Point artifact "${decl.id}" at a provider that can.`,
      `artifacts.${decl.id}.kind`,
    );
  }

  async function readTrackerArtifact(
    ctx: RepoContext,
    decl: ArtifactDecl,
    key: ItemKey,
  ): Promise<Result<ArtifactContent>> {
    if (config === null) return notConfigured();
    const number = issueNumberFor(ctx, key);
    if (!number.ok) return number;
    const base = `/repos/${encodePath(config.owner)}/${encodePath(config.repo)}/issues/${number.value}`;

    const issue = await request(githubIssueSchema, 'issue', base);
    if (!issue.ok) return issue;
    const comments = await request(githubIssueCommentsSchema, 'issue comments', `${base}/comments`, {
      per_page: String(MAX_COMMENTS),
    });
    if (!comments.ok) return comments;

    const labels = githubLabelNames(issue.value.labels ?? []);
    const sections: string[] = [`# ${issue.value.title}`];
    if (labels.length > 0) sections.push(`Labels: ${labels.join(', ')}`);
    const body = issue.value.body;
    sections.push(typeof body === 'string' && body.trim() !== '' ? body : '_No description recorded._');
    if (comments.value.length > 0) {
      sections.push('## Comments');
      for (const comment of comments.value) {
        const author = comment.user?.login ?? 'Unknown';
        const when = comment.created_at ?? comment.updated_at ?? '';
        sections.push(`### ${author}${when === '' ? '' : ` — ${when}`}`);
        const text = comment.body;
        sections.push(typeof text === 'string' && text.trim() !== '' ? text : '_(empty comment)_');
      }
    }

    // Inert text: markdown, never HTML for injection (ipc-surface.md rule 6).
    return ok(artifactContent(decl, issue.value.html_url, sections.join('\n\n')));
  }

  async function readMarkdownArtifact(
    ctx: RepoContext,
    decl: ArtifactDecl,
    key: ItemKey,
  ): Promise<Result<ArtifactContent>> {
    if (config === null) return notConfigured();
    const locatorPath = decl.locator.path;
    if (locatorPath === undefined || locatorPath === '') {
      return problem(
        'invalid_input',
        `Artifact "${decl.id}" declares no path to read. Add one to its locator.`,
        `artifacts.${decl.id}.path`,
      );
    }
    const rendered = template(locatorPath, fieldsForKey(ctx, key), `artifact "${decl.id}" path`);
    if (!rendered.ok) return rendered;
    const ref = refFor(ctx, key);
    if (!ref.ok) return ref;

    const file = await request(
      githubContentsSchema,
      'file contents',
      `/repos/${encodePath(config.owner)}/${encodePath(config.repo)}/contents/${encodePath(rendered.value)}`,
      { ref: ref.value },
    );
    if (!file.ok) return file;
    if (Array.isArray(file.value)) {
      return problem(
        'invalid_input',
        `The path "${rendered.value}" is a directory, not a file. Artifact "${decl.id}" must name a file.`,
        `artifacts.${decl.id}.path`,
      );
    }
    if (file.value.encoding !== 'base64' || file.value.content === undefined) {
      return problem(
        'unavailable',
        `GitHub did not inline the contents of "${rendered.value}" (encoding "${file.value.encoding ?? 'none'}"), which happens above its 1 MB limit. The file was not read.`,
      );
    }
    const decoded = decodeBase64(file.value.content);
    if (decoded === null) {
      return problem(
        'invalid_response',
        `The contents of "${rendered.value}" were not valid base64 and could not be decoded.`,
      );
    }
    return ok(artifactContent(decl, file.value.html_url ?? rendered.value, decoded));
  }

  async function readTestResultsArtifact(
    ctx: RepoContext,
    decl: ArtifactDecl,
    key: ItemKey,
  ): Promise<Result<ArtifactContent>> {
    const name = decl.locator.run ?? decl.locator.check;
    const runs = await readCheckRuns(ctx, key, name);
    if (!runs.ok) return runs;

    const summary = summariseCheckRuns(runs.value);
    // JSON, not HTML: `ArtifactContent` carries structured test results as inert
    // text (ipc-surface.md rule 6), shaped as `TestRunSummary`.
    return ok(artifactContent(decl, evidenceLocatorFor(runs.value, name), JSON.stringify(summary, null, 2)));
  }

  async function readCheckRuns(
    ctx: RepoContext,
    key: ItemKey,
    name: string | undefined,
  ): Promise<Result<GithubCheckRun[]>> {
    if (config === null) return notConfigured();
    const ref = refFor(ctx, key);
    if (!ref.ok) return ref;

    const params: Record<string, string> = {
      per_page: String(MAX_CHECK_RUNS),
      filter: 'latest',
    };
    if (name !== undefined && name !== '') params['check_name'] = name;

    const response = await request(
      githubCheckRunsResponseSchema,
      'check runs',
      `/repos/${encodePath(config.owner)}/${encodePath(config.repo)}/commits/${encodePath(ref.value)}/check-runs`,
      params,
    );
    if (!response.ok) return response;
    return ok([...response.value.check_runs].sort(byMostRecent));
  }

  async function readGate(
    ctx: RepoContext,
    decl: GateDecl,
    key: ItemKey,
  ): Promise<Result<GateResult>> {
    if (config === null) return notConfigured();

    if (decl.kind === 'check') return readCheckGate(ctx, decl, key);
    if (decl.kind === 'field') {
      if (decl.locator?.field === undefined) {
        return problem(
          'invalid_input',
          `Gate "${decl.id}" reads a field but declares none. Add a field to its locator.`,
          `gates.${decl.id}.field`,
        );
      }
      return readFieldGate(ctx, decl, key, decl.locator, false);
    }
    if (decl.kind === 'manual') {
      if (decl.evidence === undefined) {
        return ok(
          gateResult(
            decl.id,
            'not_evaluated',
            null,
            'This gate declares no evidence locator, so no decision can be read.',
            now,
          ),
        );
      }
      return decl.evidence.path !== undefined && decl.evidence.path !== ''
        ? readPathGate(ctx, decl, key, decl.evidence, true)
        : readFieldGate(ctx, decl, key, decl.evidence, true);
    }

    // kind: artifact — existence or absence, then the declared condition.
    const locator = decl.locator ?? {};
    return locator.path !== undefined && locator.path !== ''
      ? readPathGate(ctx, decl, key, locator, false)
      : readFieldGate(ctx, decl, key, locator, true);
  }

  async function readCheckGate(
    ctx: RepoContext,
    decl: GateDecl,
    key: ItemKey,
  ): Promise<Result<GateResult>> {
    const override = decl.configurable ? ctx.config[`gates.${decl.id}.check`] : undefined;
    const name =
      typeof override === 'string' && override !== ''
        ? override
        : (decl.locator?.check ?? decl.locator?.run);
    if (name === undefined || name === '') {
      return problem(
        'invalid_input',
        `Gate "${decl.id}" reads a check but names none. Add a check to its locator.`,
        `gates.${decl.id}.check`,
      );
    }

    const runs = await readCheckRuns(ctx, key, name);
    if (!runs.ok) return runs;

    const run = runs.value[0];
    if (run === undefined) {
      // Absence is never success (rule 5).
      return ok(
        gateResult(
          decl.id,
          'not_evaluated',
          { provider: id, locator: name },
          `No run named "${name}" has reported a result for this ref.`,
          now,
        ),
      );
    }

    const evidence: EvidenceRef = {
      provider: id,
      locator: run.html_url ?? run.details_url ?? name,
    };
    const conclusion = run.conclusion ?? null;
    if (conclusion !== null && PASSING_CONCLUSIONS.includes(conclusion)) {
      return ok(gateResult(decl.id, 'passed', evidence, `"${run.name}" concluded ${conclusion}.`, now));
    }
    if (conclusion !== null && FAILING_CONCLUSIONS.includes(conclusion)) {
      return ok(gateResult(decl.id, 'failed', evidence, `"${run.name}" concluded ${conclusion}.`, now));
    }
    return ok(
      gateResult(
        decl.id,
        'not_evaluated',
        evidence,
        conclusion === null
          ? `"${run.name}" is ${run.status} and has not concluded.`
          : `"${run.name}" concluded ${conclusion}, which is neither a pass nor a failure.`,
        now,
      ),
    );
  }

  async function readFieldGate(
    ctx: RepoContext,
    decl: GateDecl,
    key: ItemKey,
    locator: Locator,
    presenceIsDecision: boolean,
  ): Promise<Result<GateResult>> {
    const issue = await readIssue(ctx, key);
    if (!issue.ok) {
      if (issue.reason !== 'not_found') return issue;
      const condition = decl.passesWhen ?? { present: true };
      const passed = evaluateCondition(condition, null);
      return ok(
        gateResult(
          decl.id,
          passed ? 'passed' : 'failed',
          null,
          'No issue exists at that locator.',
          now,
        ),
      );
    }

    const fieldName = locator.field;
    const value =
      fieldName === undefined || fieldName === ''
        ? issue.value.number
        : issueFieldValue(issue.value, fieldName);
    const evidence: EvidenceRef = {
      provider: id,
      locator:
        fieldName === undefined || fieldName === ''
          ? issue.value.html_url
          : `${issue.value.html_url} (${fieldName})`,
    };

    // A declared condition always decides; only an undeclared one falls back to
    // presence, and absence then reads as "nothing recorded" rather than a guess.
    if (presenceIsDecision && decl.passesWhen === undefined && (value === null || value === '')) {
      return ok(
        gateResult(
          decl.id,
          'not_evaluated',
          evidence,
          `Nothing is recorded in ${fieldName ?? 'the issue'} for this gate.`,
          now,
        ),
      );
    }
    if (decl.passesWhen === undefined && !presenceIsDecision) {
      return ok(
        gateResult(
          decl.id,
          'not_evaluated',
          evidence,
          `Gate "${decl.id}" declares no passes_when condition, so its field value cannot be judged.`,
          now,
        ),
      );
    }

    const condition = decl.passesWhen ?? { present: true };
    const passed = evaluateCondition(condition, value);
    return ok(
      gateResult(
        decl.id,
        passed ? 'passed' : 'failed',
        evidence,
        `${fieldName ?? 'the issue'} is ${describeValue(value)}.`,
        now,
      ),
    );
  }

  async function readPathGate(
    ctx: RepoContext,
    decl: GateDecl,
    key: ItemKey,
    locator: Locator,
    presenceIsDecision: boolean,
  ): Promise<Result<GateResult>> {
    if (config === null) return notConfigured();
    const locatorPath = locator.path ?? '';
    const rendered = template(locatorPath, fieldsForKey(ctx, key), `gate "${decl.id}" locator`);
    if (!rendered.ok) return rendered;
    const ref = refFor(ctx, key);
    if (!ref.ok) return ref;

    const file = await request(
      githubContentsSchema,
      'file contents',
      `/repos/${encodePath(config.owner)}/${encodePath(config.repo)}/contents/${encodePath(rendered.value)}`,
      { ref: ref.value },
    );

    let value: unknown = null;
    if (file.ok) {
      value = Array.isArray(file.value)
        ? file.value.map((entry) => entry.path)
        : (decodeBase64(file.value.content ?? '') ?? file.value.path);
    } else if (file.reason !== 'not_found') {
      return file;
    }

    const evidence: EvidenceRef = { provider: id, locator: rendered.value };
    if (presenceIsDecision && value === null && decl.passesWhen === undefined) {
      return ok(
        gateResult(decl.id, 'not_evaluated', evidence, `Nothing exists at ${rendered.value}.`, now),
      );
    }
    const condition = decl.passesWhen ?? { present: true };
    const passed = evaluateCondition(condition, value);
    return ok(
      gateResult(
        decl.id,
        passed ? 'passed' : 'failed',
        evidence,
        value === null ? `Nothing exists at ${rendered.value}.` : `${rendered.value} is present.`,
        now,
      ),
    );
  }

  function artifactContent(decl: ArtifactDecl, locator: string, text: string): ArtifactContent {
    const capped = capContent(text);
    return {
      artifactId: decl.id,
      kind: decl.kind,
      provider: id,
      locator,
      content: capped.content,
      reconciledAt: nowIso(now),
      truncated: capped.truncated,
      byteLength: capped.byteLength,
    };
  }

  function evidenceLocatorFor(runs: readonly GithubCheckRun[], name: string | undefined): string {
    const first = runs[0];
    return first?.html_url ?? first?.details_url ?? name ?? config?.ref ?? DEFAULT_REF;
  }

  function subscribe(_ctx: RepoContext, onChange: () => void): Unsubscribe {
    // Remote providers poll; they do not watch (provider-interface.md §1).
    const interval = config?.pollMs ?? DEFAULT_POLL_MS;
    const timer = setInterval(() => {
      onChange();
    }, interval);
    return () => {
      clearInterval(timer);
    };
  }

  return { id, kind, health, discoverItems, readState, readArtifact, readGate, subscribe };
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function resolveSettings(decl: ProviderDecl, credential: string | undefined): ResolvedSettings {
  const settings = decl.settings;
  const owner = readString(settings, ['owner', 'org', 'organisation', 'organization']);
  const repo = readString(settings, ['repo', 'repository', 'name']);
  const ref = readString(settings, ['ref', 'branch', 'revision']);
  const apiBaseUrl = readString(settings, ['apiBaseUrl', 'api_base_url', 'baseUrl', 'base_url']);

  const missing: string[] = [];
  if (owner === null) missing.push('settings.owner (the user or organisation)');
  if (repo === null) missing.push('settings.repo (the repository name)');
  if (credential === undefined || credential === '') missing.push('an access token, set in Settings');

  if (owner === null || repo === null || missing.length > 0) return { config: null, missing };
  return {
    config: {
      apiBaseUrl: apiBaseUrl ?? DEFAULT_API_BASE_URL,
      owner,
      repo,
      ref: ref ?? DEFAULT_REF,
      pollMs: readInterval(settings, ['pollSeconds', 'poll_seconds', 'pollIntervalSeconds']),
      timeoutMs: readTimeout(settings, ['timeoutMs', 'timeout_ms', 'timeoutMilliseconds']),
    },
    missing,
  };
}

function readString(
  settings: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = settings[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function readNumber(
  settings: Readonly<Record<string, unknown>>,
  names: readonly string[],
): number | null {
  for (const name of names) {
    const value = settings[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function readInterval(
  settings: Readonly<Record<string, unknown>>,
  names: readonly string[],
): number {
  const seconds = readNumber(settings, names);
  if (seconds === null) return DEFAULT_POLL_MS;
  return Math.max(MIN_POLL_MS, Math.round(seconds * 1000));
}

function readTimeout(settings: Readonly<Record<string, unknown>>, names: readonly string[]): number {
  const ms = readNumber(settings, names);
  if (ms === null) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1000, Math.round(ms)));
}

/** Encodes a path, keeping the separators a ref or file path needs. */
function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Scopes a discovery query to the configured repository when it does not scope itself. */
function scopeQuery(query: string, owner: string, repo: string): string {
  if (/\b(repo|org|user):/i.test(query)) return query;
  return `${query} repo:${owner}/${repo}`;
}

function issueFieldValue(issue: GithubIssue, field: string): unknown {
  if (field === 'labels') return githubLabelNames(issue.labels ?? []);
  if (field === 'assignee') return issue.assignee?.login ?? null;
  const value: unknown = issue[field];
  return value === undefined ? null : value;
}

function byMostRecent(left: GithubCheckRun, right: GithubCheckRun): number {
  const leftAt = left.completed_at ?? left.started_at ?? '';
  const rightAt = right.completed_at ?? right.started_at ?? '';
  if (leftAt === rightAt) return right.id - left.id;
  return leftAt < rightAt ? 1 : -1;
}

function summariseCheckRuns(runs: readonly GithubCheckRun[]): TestRunSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const cases: { name: string; status: string; detail?: string }[] = [];

  for (const run of runs) {
    const conclusion = run.conclusion ?? null;
    if (conclusion !== null && PASSING_CONCLUSIONS.includes(conclusion)) passed += 1;
    else if (conclusion !== null && FAILING_CONCLUSIONS.includes(conclusion)) failed += 1;
    else if (conclusion !== null && SKIPPED_CONCLUSIONS.includes(conclusion)) skipped += 1;

    const detail = [run.output?.title, run.output?.summary]
      .filter((piece): piece is string => typeof piece === 'string' && piece !== '')
      .join(' — ');
    cases.push({
      name: run.name,
      status: conclusion ?? run.status,
      ...(detail === '' ? {} : { detail: truncateText(detail, 2000) }),
    });
  }

  const outcome: TestRunSummary['outcome'] = failed > 0 ? 'failed' : passed > 0 ? 'passed' : 'unknown';
  return { outcome, total: runs.length, passed, failed, skipped, cases, truncated: false };
}

function decodeBase64(value: string): string | null {
  try {
    return Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    // A malformed pattern is a manifest problem, reported where manifests are
    // validated; here it simply extracts nothing.
    return null;
  }
}

function gateResult(
  gateId: string,
  status: GateResult['status'],
  evidence: EvidenceRef | null,
  detail: string,
  now?: () => Date,
): GateResult {
  return {
    gateId,
    status,
    // Null exactly when not_evaluated (observed.ts, GateResult).
    evaluatedAt: status === 'not_evaluated' ? null : nowIso(now),
    evidence,
    detail,
  };
}

function describeValue(value: unknown): string {
  if (value === null) return 'empty';
  if (typeof value === 'string') return `"${truncateText(value, 80)}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return truncateText(JSON.stringify(value) ?? 'unreadable', 80);
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    const cause = error.cause;
    const causeMessage = cause instanceof Error ? ` (${cause.message})` : '';
    return { name: error.name, message: `${error.message}${causeMessage}` };
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : 'Error';
    const message = typeof record['message'] === 'string' ? record['message'] : 'unknown error';
    return { name, message };
  }
  return { name: 'Error', message: String(error) };
}

/** GitHub reports an exhausted quota as 403 with the remaining budget at zero. */
function isRateLimited(headers: Headers | null): boolean {
  if (headers === null) return false;
  if (headers.get('x-ratelimit-remaining') === '0') return true;
  return headers.get('retry-after') !== null;
}

function healthStatusFor(reason: FailureReason): ProviderHealthStatus {
  switch (reason) {
    case 'not_configured':
      return 'not_configured';
    case 'unauthenticated':
      return 'unauthenticated';
    case 'rate_limited':
      return 'rate_limited';
    case 'invalid_response':
    case 'unavailable':
      return 'unsupported';
    default:
      return 'unreachable';
  }
}

/** FR-021: cap the content, and report the real size rather than the capped one. */
function capContent(text: string): { content: string; truncated: boolean; byteLength: number } {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= MAX_ARTIFACT_BYTES) {
    return { content: text, truncated: false, byteLength: encoded.byteLength };
  }
  let end = MAX_ARTIFACT_BYTES;
  // Do not split a UTF-8 sequence: step back over continuation bytes.
  while (end > 0 && ((encoded[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1;
  const content = new TextDecoder().decode(encoded.subarray(0, end));
  return { content, truncated: true, byteLength: encoded.byteLength };
}
