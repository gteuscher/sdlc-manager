/**
 * T028 — the Jira provider.
 *
 * Plain `fetch`, no vendor SDK (Principle III, FR-017). Every response is parsed
 * through `./schema.js` before it leaves this module (Principle IX), every
 * expected failure is a `Result` rather than a throw (provider-interface.md
 * rule 1), and no method here names a lifecycle state: translating Jira's raw
 * status into a declared state is the engine's job, because the mapping lives in
 * the manifest (rule 2).
 *
 * Settings (`providers[].` in `sdlc.yaml`, see sdlc-manifest.md §3):
 *
 *   base_url   REQUIRED  https://acme.atlassian.net
 *   email      REQUIRED  the Atlassian account the API token belongs to
 *   project    optional  scopes discovery when the rule's JQL does not
 *   poll_seconds  optional, default 60 — remote providers poll, they do not watch
 *   timeout_ms    optional, default and ceiling 10000 (Principle X)
 *
 * The credential is an Atlassian API token, supplied by the composition root
 * from `safeStorage`. It is used as HTTP Basic, never placed in a URL, and never
 * reaches a message, an error, or a log line (rule 4).
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
  jiraCommentsResponseSchema,
  jiraDocumentToText,
  jiraErrorResponseSchema,
  jiraFieldIssueSchema,
  jiraFieldToValue,
  jiraIssueSchema,
  jiraMyselfSchema,
  jiraSearchResponseSchema,
  jiraStatusIssueSchema,
  parseJira,
} from './schema.js';

const API_PREFIX = '/rest/api/3';
const DEFAULT_POLL_MS = 60_000;
const MIN_POLL_MS = 5_000;
/** Principle X: ten seconds is the default ceiling for a provider-bound wait. */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 10_000;
/** FR-021: very large artifacts are truncated honestly rather than streamed. */
const MAX_ARTIFACT_BYTES = 512 * 1024;
const MAX_DISCOVERY_RESULTS = 50;
const MAX_COMMENTS = 50;
const ERROR_EXCERPT_CHARS = 240;

interface JiraConfig {
  readonly baseUrl: string;
  readonly email: string;
  readonly project: string | null;
  readonly pollMs: number;
  readonly timeoutMs: number;
}

interface ResolvedSettings {
  readonly config: JiraConfig | null;
  readonly missing: readonly string[];
}

export function createJiraProvider(options: ProviderOptions): Provider {
  const id = options.decl.id;
  const kind = options.decl.kind;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now;
  const { config, missing } = resolveSettings(options.decl, options.credential);

  const authorization =
    config !== null && options.credential !== undefined && options.credential !== ''
      ? encodeBasic(config.email, options.credential)
      : null;

  /** Everything that must never appear in a message, an error, or a log line (rule 4). */
  const secrets: readonly string[] = [options.credential ?? '', authorization ?? '']
    .filter((secret) => secret.length >= 4)
    .concat(authorization !== null ? [authorization.slice('Basic '.length)] : []);

  function scrub(text: string): string {
    let scrubbed = text;
    for (const secret of secrets) {
      if (secret.length < 4) continue;
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
    if (config === null || authorization === null) return notConfigured();

    const url = buildUrl(config.baseUrl, path, params);
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
        headers: { authorization, accept: 'application/json' },
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
          `Reading the ${what} from Jira timed out after ${config.timeoutMs}ms. The site may be slow or unreachable; retry when it responds.`,
        );
      }
      return problem(
        'unreachable',
        `Could not reach Jira to read the ${what}: ${described.message}. Check the site URL and the network.`,
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
        `Jira's ${what} response was not valid JSON. The response was discarded rather than guessed at.`,
      );
    }

    const parsed = parseJira(schema, decoded, what);
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
    const suffix = excerpt === '' ? '' : ` Jira said: ${excerpt}`;

    if (status === 401) {
      return problem(
        'unauthenticated',
        `Jira rejected the credential for ${id} while reading the ${what} (401). Update the API token for this provider in Settings.${suffix}`,
      );
    }
    if (status === 429 || (status === 403 && isRateLimited(headers))) {
      const retry = headers?.get('retry-after');
      const wait = retry === null || retry === undefined ? '' : ` Retry after ${retry}s.`;
      return problem(
        'rate_limited',
        `Jira rate-limited the ${id} provider while reading the ${what}.${wait} The value shown may be stale until the limit clears.${suffix}`,
      );
    }
    if (status === 403) {
      return problem(
        'unauthenticated',
        `The credential for ${id} is not permitted to read the ${what} (403). Grant the account access to the project, or use a token with wider scope.${suffix}`,
      );
    }
    if (status === 404) {
      return problem(
        'not_found',
        `Jira has no ${what} at that locator (404). Check the issue key or field name in the manifest.${suffix}`,
      );
    }
    if (status === 400 || status === 410 || status === 422) {
      return problem(
        'invalid_input',
        `Jira rejected the request for the ${what} (${status}). The query or locator in the manifest is not valid for this site.${suffix}`,
      );
    }
    if (status >= 500) {
      return problem(
        'unreachable',
        `Jira returned ${status} while reading the ${what}. The site is unavailable; retry later.${suffix}`,
      );
    }
    return problem(
      'invalid_response',
      `Jira returned an unexpected ${status} while reading the ${what}.${suffix}`,
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
    const parsed = jiraErrorResponseSchema.safeParse(decoded);
    if (!parsed.success) return '';
    const messages = [
      ...(parsed.data.errorMessages ?? []),
      ...(parsed.data.message === undefined ? [] : [parsed.data.message]),
      ...Object.entries(parsed.data.errors ?? {}).map(([field, text]) => `${field}: ${text}`),
    ];
    return truncateText(scrub(messages.join('; ')), ERROR_EXCERPT_CHARS);
  }

  // ── Identity ──────────────────────────────────────────────────────────────

  /**
   * Extracts the identity fields a locator template may reference, applying
   * `items.identity.patterns[<this provider>]` when the manifest declares one.
   */
  function identityFor(
    ctx: RepoContext,
    candidates: readonly string[],
    fallbackKey: string,
  ): { readonly key: ItemKey; readonly fields: Readonly<Record<string, string>> } {
    const identity = ctx.definition.items.identity;
    const fields: Record<string, string> = { key: fallbackKey };
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

  /**
   * The fields available when only an `ItemKey` is in hand — every read below
   * `discoverItems` is addressed by key, so the pattern is re-applied to it.
   */
  function fieldsForKey(ctx: RepoContext, key: ItemKey): Readonly<Record<string, string>> {
    return identityFor(ctx, [key], key).fields;
  }

  function issueKeyFor(ctx: RepoContext, key: ItemKey): string {
    return fieldsForKey(ctx, key)['key'] ?? key;
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

  // ── Interface ─────────────────────────────────────────────────────────────

  async function health(): Promise<ProviderHealth> {
    if (config === null) return unconfigured(id, kind, missing.join('; '), now);

    const probe = await request(jiraMyselfSchema, 'account', `${API_PREFIX}/myself`);
    if (probe.ok) return healthy(id, kind, now);
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
          `A discovery rule names ${id} but declares no query. Give the rule a JQL query, or remove it.`,
          'items.discover',
        );
      }
      const response = await request(jiraSearchResponseSchema, 'issue search', `${API_PREFIX}/search/jql`, {
        jql: scopeJql(rule.query, config.project),
        maxResults: String(MAX_DISCOVERY_RESULTS),
        fields: 'summary,status,assignee',
      });
      if (!response.ok) return response;

      for (const issue of response.value.issues) {
        const identity = identityFor(ctx, [issue.key], issue.key);
        if (seen.has(identity.key)) continue;
        seen.add(identity.key);
        const item: RawItem = {
          key: identity.key,
          source: id,
          fields: identity.fields,
          ...(typeof issue.fields.summary === 'string' ? { title: issue.fields.summary } : {}),
          // The provider's own vocabulary, never a declared state (rule 2).
          ...(issue.fields.status !== undefined ? { rawState: issue.fields.status.name } : {}),
          ...(issue.fields.assignee !== null && issue.fields.assignee !== undefined
            ? { assignee: displayNameOf(issue.fields.assignee) }
            : {}),
        };
        items.push(item);
      }
    }
    return ok(items);
  }

  async function readState(ctx: RepoContext, key: ItemKey): Promise<Result<RawState>> {
    if (config === null) return notConfigured();

    const issueKey = issueKeyFor(ctx, key);
    const response = await request(
      jiraStatusIssueSchema,
      'issue status',
      `${API_PREFIX}/issue/${encodePathSegment(issueKey)}`,
      { fields: 'status' },
    );
    if (!response.ok) return response;
    // Raw, exactly as Jira words it. The engine maps it via the manifest.
    return ok({ value: response.value.fields.status.name, observedAt: nowIso(now) });
  }

  async function readArtifact(
    ctx: RepoContext,
    decl: ArtifactDecl,
    key: ItemKey,
  ): Promise<Result<ArtifactContent>> {
    if (config === null) return notConfigured();
    if (decl.kind !== 'tracker') {
      return problem(
        'unavailable',
        `The ${id} provider reads tracker artifacts only; artifact "${decl.id}" declares kind "${decl.kind}". Point it at a provider that can read it.`,
        `artifacts.${decl.id}.kind`,
      );
    }

    const fields = fieldsForKey(ctx, key);
    const issueKeyResult = resolveIssueKey(ctx, decl.locator, key, fields, `artifact "${decl.id}"`);
    if (!issueKeyResult.ok) return issueKeyResult;
    const issueKey = issueKeyResult.value;

    const issue = await request(
      jiraIssueSchema,
      'issue',
      `${API_PREFIX}/issue/${encodePathSegment(issueKey)}`,
      { fields: 'summary,description,status,updated' },
    );
    if (!issue.ok) return issue;

    const comments = await request(
      jiraCommentsResponseSchema,
      'issue comments',
      `${API_PREFIX}/issue/${encodePathSegment(issueKey)}/comment`,
      { maxResults: String(MAX_COMMENTS), orderBy: 'created' },
    );
    if (!comments.ok) return comments;

    const sections: string[] = [];
    const summary = issue.value.fields.summary;
    sections.push(`# ${typeof summary === 'string' ? summary : issueKey}`);
    const description = jiraDocumentToText(issue.value.fields.description);
    sections.push(description === '' ? '_No description recorded._' : description);
    if (comments.value.comments.length > 0) {
      sections.push('## Comments');
      for (const comment of comments.value.comments) {
        const author = comment.author === null || comment.author === undefined ? 'Unknown' : displayNameOf(comment.author);
        const when = comment.created ?? comment.updated ?? '';
        sections.push(`### ${author}${when === '' ? '' : ` — ${when}`}`);
        const text = jiraDocumentToText(comment.body);
        sections.push(text === '' ? '_(empty comment)_' : text);
      }
    }

    // Inert text: markdown, never HTML for injection (ipc-surface.md rule 6).
    const capped = capContent(sections.join('\n\n'));
    return ok({
      artifactId: decl.id,
      kind: decl.kind,
      provider: id,
      locator: browseUrl(config.baseUrl, issueKey),
      content: capped.content,
      reconciledAt: nowIso(now),
      truncated: capped.truncated,
      byteLength: capped.byteLength,
    });
  }

  async function readGate(
    ctx: RepoContext,
    decl: GateDecl,
    key: ItemKey,
  ): Promise<Result<GateResult>> {
    if (config === null) return notConfigured();

    const fields = fieldsForKey(ctx, key);

    if (decl.kind === 'check') {
      // Jira records no check runs. Absence is never success (rule 5).
      return ok(
        gateResult(
          decl.id,
          'not_evaluated',
          null,
          `The ${id} provider records no check results; nothing has been evaluated for this gate.`,
          now,
        ),
      );
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
      return readFieldGate(ctx, decl, key, fields, decl.evidence, true);
    }

    if (decl.kind === 'field') {
      if (decl.locator?.field === undefined) {
        return problem(
          'invalid_input',
          `Gate "${decl.id}" reads a field but declares none. Add a field to its locator.`,
          `gates.${decl.id}.field`,
        );
      }
      return readFieldGate(ctx, decl, key, fields, decl.locator, false);
    }

    // kind: artifact — existence or absence of the tracker item (or of one field on it).
    return readArtifactGate(ctx, decl, key, fields);
  }

  async function readFieldGate(
    ctx: RepoContext,
    decl: GateDecl,
    key: ItemKey,
    fields: Readonly<Record<string, string>>,
    locator: Locator,
    presenceIsDecision: boolean,
  ): Promise<Result<GateResult>> {
    if (config === null) return notConfigured();
    const fieldName = locator.field;
    if (fieldName === undefined || fieldName === '') {
      return problem(
        'invalid_input',
        `Gate "${decl.id}" names no field to read. Add a field to its locator.`,
        `gates.${decl.id}.field`,
      );
    }

    const issueKeyResult = resolveIssueKey(ctx, locator, key, fields, `gate "${decl.id}"`);
    if (!issueKeyResult.ok) return issueKeyResult;
    const issueKey = issueKeyResult.value;

    const response = await request(
      jiraFieldIssueSchema,
      'issue field',
      `${API_PREFIX}/issue/${encodePathSegment(issueKey)}`,
      { fields: fieldName },
    );
    if (!response.ok) return response;

    const raw = jiraFieldToValue(response.value.fields[fieldName]);
    const evidence = evidenceRef(browseUrl(config.baseUrl, issueKey), fieldName);

    // A declared condition always decides; only an undeclared one falls back to
    // presence, and absence then reads as "nothing recorded" rather than a guess.
    if (presenceIsDecision && decl.passesWhen === undefined && (raw === null || raw === '')) {
      return ok(
        gateResult(
          decl.id,
          'not_evaluated',
          evidence,
          `No decision is recorded in ${fieldName} on ${issueKey}.`,
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
    const passed = evaluateCondition(condition, raw);
    return ok(
      gateResult(
        decl.id,
        passed ? 'passed' : 'failed',
        evidence,
        `${fieldName} on ${issueKey} is ${describeValue(raw)}.`,
        now,
      ),
    );
  }

  async function readArtifactGate(
    ctx: RepoContext,
    decl: GateDecl,
    key: ItemKey,
    fields: Readonly<Record<string, string>>,
  ): Promise<Result<GateResult>> {
    if (config === null) return notConfigured();
    const locator = decl.locator ?? {};
    const issueKeyResult = resolveIssueKey(ctx, locator, key, fields, `gate "${decl.id}"`);
    if (!issueKeyResult.ok) return issueKeyResult;
    const issueKey = issueKeyResult.value;

    const fieldName = locator.field;
    const response = await request(
      jiraFieldIssueSchema,
      'issue',
      `${API_PREFIX}/issue/${encodePathSegment(issueKey)}`,
      { fields: fieldName ?? 'summary' },
    );

    let value: unknown = null;
    if (response.ok) {
      value =
        fieldName === undefined
          ? response.value.key
          : jiraFieldToValue(response.value.fields[fieldName]);
    } else if (response.reason !== 'not_found') {
      return response;
    }

    const evidence = evidenceRef(browseUrl(config.baseUrl, issueKey), fieldName ?? issueKey);
    const condition = decl.passesWhen ?? { present: true };
    const passed = evaluateCondition(condition, value);
    return ok(
      gateResult(
        decl.id,
        passed ? 'passed' : 'failed',
        evidence,
        value === null
          ? `Nothing is recorded at ${fieldName ?? issueKey}.`
          : `${fieldName ?? issueKey} is ${describeValue(value)}.`,
        now,
      ),
    );
  }

  function resolveIssueKey(
    ctx: RepoContext,
    locator: Locator,
    key: ItemKey,
    fields: Readonly<Record<string, string>>,
    where: string,
  ): Result<string> {
    if (locator.path !== undefined && locator.path !== '') {
      return template(locator.path, fields, `${where} locator`);
    }
    return ok(issueKeyFor(ctx, key));
  }

  function evidenceRef(url: string, detail: string): EvidenceRef {
    return { provider: id, locator: detail === '' ? url : `${url} (${detail})` };
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
  const baseUrl = readString(settings, ['baseUrl', 'base_url', 'url', 'site']);
  const email = readString(settings, ['email', 'accountEmail', 'account_email', 'user', 'username']);
  const project = readString(settings, ['project', 'projectKey', 'project_key']);

  const missing: string[] = [];
  if (baseUrl === null) missing.push('settings.base_url (the Jira site URL, e.g. https://acme.atlassian.net)');
  if (email === null) missing.push('settings.email (the Atlassian account the API token belongs to)');
  if (credential === undefined || credential === '') missing.push('an API token, set in Settings');

  if (baseUrl === null || email === null || missing.length > 0) {
    return { config: null, missing };
  }
  return {
    config: {
      baseUrl,
      email,
      project,
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

function encodeBasic(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`;
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function browseUrl(baseUrl: string, issueKey: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/browse/${encodePathSegment(issueKey)}`;
}

/**
 * Scopes a discovery rule's JQL to the configured project when the rule does not
 * scope itself. A manifest that already names a project is left alone.
 */
function scopeJql(query: string, project: string | null): string {
  if (project === null) return query;
  if (/\bproject\s*(=|!=|~|\bin\b|\bnot\b)/i.test(query)) return query;
  return `project = "${project.replace(/"/g, '\\"')}" AND (${query})`;
}

function displayNameOf(user: { displayName?: string; emailAddress?: string; accountId?: string }): string {
  return user.displayName ?? user.emailAddress ?? user.accountId ?? '';
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

function isRateLimited(headers: Headers | null): boolean {
  if (headers === null) return false;
  if (headers.get('retry-after') !== null) return true;
  return headers.get('x-ratelimit-remaining') === '0';
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
