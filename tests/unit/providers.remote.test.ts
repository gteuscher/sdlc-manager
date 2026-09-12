/**
 * T031 — the two remote providers, driven entirely by recorded responses.
 *
 * Four of the six rules in contracts/provider-interface.md §2 are asserted here:
 *
 *   rule 1  Never throw for an expected failure. A 401, a 429, a 404, a 500 and a
 *           refused connection are `Result` failures with a typed reason. This is
 *           Principle III's blast-radius rule in its smallest form: an exception
 *           escaping an adapter is an exception the item list cannot render
 *           around, so one unreachable tracker would blank the dashboard.
 *   rule 2  Never map. `readState` returns the system's own word — the engine
 *           turns it into a state, because the mapping lives in the manifest.
 *   rule 3  Validate at the boundary. A field the vendor renamed becomes a typed
 *           `invalid_response` naming the path that moved, rather than an
 *           exception three layers up inside the engine.
 *   rule 5  Return `not_evaluated`, never a guess. A queued or absent check run is
 *           not a pass (FR-014, SC-005).
 *
 * And rule 6: unconfigured means every read reports `not_configured` and
 * `health()` names what is missing, by name (FR-026, FR-035).
 *
 * NO TEST HERE TOUCHES THE NETWORK. Every provider is constructed with an
 * injected `options.fetch` returning a recorded body, and `globalThis.fetch` is
 * replaced with a tripwire that throws if anything reaches for it (Principle III:
 * no test suite performs live network calls).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArtifactDecl, GateDecl, ProviderDecl, SdlcDefinition } from '@core/model/declared';
import type { Result } from '@core/model/result';
import type { Provider, RepoContext } from '@providers/contract';
import { createGithubProvider } from '@providers/github/index';
import { createJiraProvider } from '@providers/jira/index';

import { gate, lifecycle } from '../support/lifecycle';

// ── The offline harness ──────────────────────────────────────────────────────

type FetchLike = typeof globalThis.fetch;

interface RecordedCall {
  readonly url: string;
  readonly headers: Headers;
}

interface Reply {
  /** Defaults to 200. */
  readonly status?: number;
  /** An object is serialised as JSON; a string is sent verbatim. */
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** When set, `fetch` rejects with this instead of answering. */
  readonly throws?: Error;
}

/** A `fetch` that answers from a recording. Records every call, so the URL can be inspected. */
function recorded(reply: Reply, calls: RecordedCall[] = []): FetchLike {
  const impl: FetchLike = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    if (reply.throws !== undefined) throw reply.throws;
    const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? null);
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? {} });
  };
  return impl;
}

/** A `fetch` that answers each call from the next recording in the list. */
function recordedSequence(replies: readonly Reply[], calls: RecordedCall[] = []): FetchLike {
  let index = 0;
  const impl: FetchLike = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    const reply = replies[Math.min(index, replies.length - 1)] ?? {};
    index += 1;
    if (reply.throws !== undefined) throw reply.throws;
    const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? null);
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? {} });
  };
  return impl;
}

/** A `fetch` that must never be called. */
function forbiddenFetch(): FetchLike {
  const impl: FetchLike = async () => {
    throw new Error('a request was made when none should have been');
  };
  return impl;
}

function reasonOf(result: Result<unknown>): string {
  return result.ok ? `ok (expected a failure): ${JSON.stringify(result.value)}` : result.reason;
}

function messageOf(result: Result<unknown>): string {
  return result.ok ? '' : result.message;
}

const NOW = (): Date => new Date('2026-09-11T12:00:00.000Z');

beforeEach(() => {
  // The tripwire. Nothing in this file may fall back to the real `fetch`; if a
  // provider ever stops honouring `options.fetch`, this is what says so.
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('a live network call was attempted from a unit test');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── The lifecycle under test ─────────────────────────────────────────────────
//
// Invented vocabulary (tests/support/lifecycle.ts): if the providers could only be
// tested against a lifecycle resembling the contract's example, nothing would
// prove they are generic over lifecycles.

const TRACKER = 'tracker';
const CHECKS = 'checks';
const ITEM_KEY = 'PARCEL-7';
const GITHUB_ITEM_KEY = 'acme/parcels#7';

const JIRA_SITE = 'https://parcels.example.invalid';

function jiraDecl(settings?: Record<string, unknown>): ProviderDecl {
  return {
    id: TRACKER,
    kind: 'jira',
    settings: settings ?? { base_url: JIRA_SITE, email: 'dana@parcels.example.invalid' },
  };
}

function githubDecl(settings?: Record<string, unknown>): ProviderDecl {
  return { id: CHECKS, kind: 'github', settings: settings ?? { owner: 'acme', repo: 'parcels' } };
}

/** Three states whose declared ids are deliberately nothing like the raw words below. */
function definitionOwnedBy(owner: string, decl: ProviderDecl): SdlcDefinition {
  const base = lifecycle({
    owner,
    providers: [decl],
    states: [
      { id: 'intake', maps: { [owner]: ['Logged', 'open'] } },
      { id: 'appraisal', maps: { [owner]: ['Being appraised'] } },
      { id: 'settled', terminal: true, maps: { [owner]: ['Closed', 'closed'] } },
    ],
  });
  // The discovery rule a remote provider needs: a query, not a glob.
  return {
    ...base,
    items: {
      ...base.items,
      discover: [{ provider: owner, query: 'assignee = currentUser() AND resolution IS EMPTY' }],
    },
  };
}

const JIRA_DEFINITION = definitionOwnedBy(TRACKER, jiraDecl());
const GITHUB_DEFINITION = definitionOwnedBy(CHECKS, githubDecl());

function contextFor(definition: SdlcDefinition): RepoContext {
  return {
    repositoryId: 'repo-parcels',
    repositoryPath: '/not/read/by/a/remote/provider',
    definition,
    config: {},
  };
}

const JIRA_CTX = contextFor(JIRA_DEFINITION);
const GITHUB_CTX = contextFor(GITHUB_DEFINITION);

const trackerArtifact: ArtifactDecl = {
  id: 'ticket',
  name: 'Ticket',
  kind: 'tracker',
  provider: TRACKER,
  locator: {},
  required: false,
};

const fieldGate: GateDecl = {
  ...gate({ id: 'valued', kind: 'field', passesWhen: { present: true } }),
  locator: { field: 'customfield_10032' },
};

/** A gate of kind `check`, which is the only kind rule 5 is about. */
function checkGate(name: string): GateDecl {
  return { ...gate({ id: 'weighed', kind: 'check' }), locator: { check: name } };
}

const CHECK_NAME = 'weigh-bridge';

// ── Recorded responses ───────────────────────────────────────────────────────
//
// Each of these is the shape its Zod schema in `src/providers/*/schema.ts`
// documents for one endpoint, trimmed of fields no schema reads. They are the
// fixtures rule 3 is asserted against: change one in a way the vendor might, and
// the boundary must turn it into a typed failure.

/** GET {site}/rest/api/3/myself */
const JIRA_MYSELF = {
  accountId: '5b10a2844c20165700ede21g',
  displayName: 'Dana Hale',
  emailAddress: 'dana@parcels.example.invalid',
  active: true,
};

/** GET {site}/rest/api/3/issue/PARCEL-7?fields=status */
const JIRA_ISSUE_STATUS = {
  id: '10007',
  self: `${JIRA_SITE}/rest/api/3/issue/10007`,
  key: ITEM_KEY,
  fields: {
    status: {
      id: '10002',
      name: 'Being appraised',
      statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
    },
  },
};

/** GET {site}/rest/api/3/search/jql?jql=... */
const JIRA_SEARCH = {
  isLast: true,
  issues: [
    {
      id: '10007',
      key: ITEM_KEY,
      fields: {
        summary: 'Crate of glassware, Rotterdam',
        status: { id: '10002', name: 'Being appraised' },
        assignee: { accountId: '5b10a2844c20165700ede21g', displayName: 'Dana Hale' },
      },
    },
  ],
};

/** GET /repos/acme/parcels */
const GITHUB_REPOSITORY = {
  name: 'parcels',
  full_name: 'acme/parcels',
  default_branch: 'main',
  private: false,
  archived: false,
  html_url: 'https://github.example.invalid/acme/parcels',
};

/** GET /repos/acme/parcels/issues/7 */
const GITHUB_ISSUE = {
  number: 7,
  title: 'Crate of glassware, Rotterdam',
  body: 'Arrived damp.',
  state: 'open',
  state_reason: null,
  html_url: 'https://github.example.invalid/acme/parcels/issues/7',
  user: { login: 'dhale' },
  assignee: { login: 'dhale' },
  labels: [{ name: 'fragile' }],
  comments: 0,
  created_at: '2026-09-01T08:00:00Z',
  updated_at: '2026-09-10T08:00:00Z',
};

/** GET /repos/acme/parcels/commits/HEAD/check-runs?check_name=... */
function githubCheckRuns(run: Record<string, unknown> | null): Record<string, unknown> {
  return { total_count: run === null ? 0 : 1, check_runs: run === null ? [] : [run] };
}

function checkRun(status: string, conclusion: string | null): Record<string, unknown> {
  return {
    id: 4411,
    name: CHECK_NAME,
    status,
    conclusion,
    started_at: '2026-09-10T08:00:00Z',
    completed_at: conclusion === null ? null : '2026-09-10T08:05:00Z',
    html_url: 'https://github.example.invalid/acme/parcels/runs/4411',
    output: { title: 'Weighbridge', summary: 'reported', annotations_count: 0 },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Rule 2 — a provider returns the system's raw vocabulary, never a state id
// ═════════════════════════════════════════════════════════════════════════════

describe('rule 2: a provider never maps a raw value to a declared state', () => {
  const declaredIds = JIRA_DEFINITION.states.map((state) => state.id);

  it('Jira readState returns the site’s own status word', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: JIRA_ISSUE_STATUS }),
      now: NOW,
    });

    const result = await provider.readState(JIRA_CTX, ITEM_KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe('Being appraised');
  });

  it('Jira readState returns a value that is not any declared state id', async () => {
    // The manifest maps "Being appraised" onto the state `appraisal`. If the
    // provider returned `appraisal`, the mapping would have moved out of the
    // manifest and into an adapter — which is exactly what rule 2 forbids, and
    // what would make a second Jira site with different status words unreadable.
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: JIRA_ISSUE_STATUS }),
      now: NOW,
    });

    const result = await provider.readState(JIRA_CTX, ITEM_KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(declaredIds).not.toContain(result.value.value);
  });

  it('Jira discoverItems carries the raw status through unmapped', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: JIRA_SEARCH }),
      now: NOW,
    });

    const result = await provider.discoverItems(JIRA_CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.rawState)).toEqual(['Being appraised']);
    for (const item of result.value) {
      expect(declaredIds).not.toContain(item.rawState);
    }
  });

  it('GitHub readState returns GitHub’s own word for the issue’s status', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ body: GITHUB_ISSUE }),
      now: NOW,
    });

    const result = await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe('open');
    expect(GITHUB_DEFINITION.states.map((state) => state.id)).not.toContain(result.value.value);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Rule 5 — a check run that is queued or absent is not_evaluated, never passed
// ═════════════════════════════════════════════════════════════════════════════

describe('rule 5 (FR-014): absence is never success', () => {
  function githubWithRuns(run: Record<string, unknown> | null): Provider {
    return createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ body: githubCheckRuns(run) }),
      now: NOW,
    });
  }

  it('reports a queued run as not_evaluated', async () => {
    const result = await githubWithRuns(checkRun('queued', null)).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('not_evaluated');
  });

  it('reports an in-progress run as not_evaluated', async () => {
    const result = await githubWithRuns(checkRun('in_progress', null)).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('not_evaluated');
  });

  it('reports an absent run as not_evaluated rather than passed', async () => {
    // The failure this defends against is the tempting one: no failing run was
    // found, therefore nothing is wrong. A gate nobody ran is not a gate that
    // passed (Principle V, SC-005).
    const result = await githubWithRuns(null).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('not_evaluated');
    expect(result.value.detail).toContain(CHECK_NAME);
  });

  it('leaves evaluatedAt null exactly when nothing was evaluated', async () => {
    const pending = await githubWithRuns(checkRun('queued', null)).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    const settled = await githubWithRuns(checkRun('completed', 'success')).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    expect(pending.ok && pending.value.evaluatedAt).toBeNull();
    expect(settled.ok && settled.value.evaluatedAt).not.toBeNull();
  });

  it('still reports a concluded run as passed or failed, so not_evaluated is a judgement and not a constant', async () => {
    const passed = await githubWithRuns(checkRun('completed', 'success')).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    const failed = await githubWithRuns(checkRun('completed', 'failure')).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    expect(passed.ok && passed.value.status).toBe('passed');
    expect(failed.ok && failed.value.status).toBe('failed');
  });

  it('reports an inconclusive conclusion as not_evaluated, not as a pass', async () => {
    // `neutral` and `skipped` are neither. Rounding either one up to a pass would
    // report a gate as satisfied that nobody satisfied.
    const result = await githubWithRuns(checkRun('completed', 'neutral')).readGate(
      GITHUB_CTX,
      checkGate(CHECK_NAME),
      GITHUB_ITEM_KEY,
    );
    expect(result.ok && result.value.status).toBe('not_evaluated');
  });

  it('Jira reports a check gate as not_evaluated, because it records no check runs', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: forbiddenFetch(),
      now: NOW,
    });

    const result = await provider.readGate(JIRA_CTX, checkGate(CHECK_NAME), ITEM_KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('not_evaluated');
    expect(result.value.evaluatedAt).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Rule 3 — a response that does not match its schema is a typed failure
// ═════════════════════════════════════════════════════════════════════════════

describe('rule 3: a shape change becomes a typed failure, not a crash', () => {
  it('Jira: a renamed status field yields invalid_response naming the path that moved', async () => {
    // The whole point of the T030 boundary: Atlassian renaming a field is a
    // Tuesday, and it must cost one legible failure on one row rather than an
    // exception inside the engine (Principle IX).
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: { key: ITEM_KEY, fields: { statusValue: { name: 'Being appraised' } } } }),
      now: NOW,
    });

    const result = await provider.readState(JIRA_CTX, ITEM_KEY);
    expect(reasonOf(result)).toBe('invalid_response');
    expect(result.ok ? '' : result.field).toBe('fields.status');
  });

  it('Jira: a body that is not JSON at all yields invalid_response', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: '<html><body>Atlassian maintenance</body></html>' }),
      now: NOW,
    });

    expect(reasonOf(await provider.readState(JIRA_CTX, ITEM_KEY))).toBe('invalid_response');
  });

  it('Jira: a search response missing its issues array yields invalid_response', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: { values: [] } }),
      now: NOW,
    });

    expect(reasonOf(await provider.discoverItems(JIRA_CTX))).toBe('invalid_response');
  });

  it('GitHub: a check-runs payload missing check_runs yields invalid_response naming it', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ body: { total_count: 1, runs: [] } }),
      now: NOW,
    });

    const result = await provider.readGate(GITHUB_CTX, checkGate(CHECK_NAME), GITHUB_ITEM_KEY);
    expect(reasonOf(result)).toBe('invalid_response');
    expect(result.ok ? '' : result.field).toBe('check_runs');
  });

  it('GitHub: an issue whose state is no longer a string yields invalid_response', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ body: { ...GITHUB_ISSUE, state: 1 } }),
      now: NOW,
    });

    const result = await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY);
    expect(reasonOf(result)).toBe('invalid_response');
    expect(result.ok ? '' : result.field).toBe('state');
  });

  it('GitHub: a body that is not JSON at all yields invalid_response', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ body: 'not json' }),
      now: NOW,
    });

    expect(reasonOf(await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY))).toBe('invalid_response');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Rule 1 — every expected HTTP failure is a typed Result, and nothing throws
// ═════════════════════════════════════════════════════════════════════════════

interface StatusCase {
  readonly what: string;
  readonly reply: Reply;
  readonly reason: string;
}

const JIRA_STATUS_CASES: readonly StatusCase[] = [
  {
    what: 'an expired or wrong credential (401)',
    reply: { status: 401, body: { errorMessages: ['Client must be authenticated to access this resource.'] } },
    reason: 'unauthenticated',
  },
  {
    what: 'a rate limit (429)',
    reply: { status: 429, body: { errorMessages: ['Rate limit exceeded'] }, headers: { 'retry-after': '30' } },
    reason: 'rate_limited',
  },
  {
    what: 'a rate-limited 403, which is how a site reports an exhausted quota',
    reply: { status: 403, body: {}, headers: { 'retry-after': '60' } },
    reason: 'rate_limited',
  },
  {
    what: 'a missing issue (404)',
    reply: { status: 404, body: { errorMessages: ['Issue does not exist or you do not have permission to see it.'] } },
    reason: 'not_found',
  },
  {
    what: 'a site outage (500)',
    reply: { status: 500, body: '<html>error</html>' },
    reason: 'unreachable',
  },
  {
    what: 'a site outage (503)',
    reply: { status: 503, body: '' },
    reason: 'unreachable',
  },
  {
    what: 'a refused connection',
    reply: { throws: Object.assign(new Error('fetch failed'), { cause: new Error('ECONNREFUSED') }) },
    reason: 'unreachable',
  },
  {
    what: 'a request that timed out',
    reply: { throws: Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }) },
    reason: 'unreachable',
  },
];

const GITHUB_STATUS_CASES: readonly StatusCase[] = [
  {
    what: 'a revoked token (401)',
    reply: { status: 401, body: { message: 'Bad credentials' } },
    reason: 'unauthenticated',
  },
  {
    what: 'a secondary rate limit (429)',
    reply: { status: 429, body: { message: 'You have exceeded a secondary rate limit' }, headers: { 'retry-after': '45' } },
    reason: 'rate_limited',
  },
  {
    what: 'an exhausted quota, which GitHub reports as 403 with no budget left',
    reply: {
      status: 403,
      body: { message: 'API rate limit exceeded' },
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1789000000' },
    },
    reason: 'rate_limited',
  },
  {
    what: 'a repository the token cannot see (404)',
    reply: { status: 404, body: { message: 'Not Found' } },
    reason: 'not_found',
  },
  {
    what: 'an API outage (500)',
    reply: { status: 500, body: { message: 'Server Error' } },
    reason: 'unreachable',
  },
  {
    what: 'an API outage (502)',
    reply: { status: 502, body: '' },
    reason: 'unreachable',
  },
  {
    what: 'a refused connection',
    reply: { throws: Object.assign(new Error('fetch failed'), { cause: new Error('ENOTFOUND') }) },
    reason: 'unreachable',
  },
  {
    what: 'a request that timed out',
    reply: { throws: Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }) },
    reason: 'unreachable',
  },
];

describe('rule 1: Jira turns every expected failure into a typed Result', () => {
  for (const testCase of JIRA_STATUS_CASES) {
    it(`reports ${testCase.what} as ${testCase.reason}, without throwing`, async () => {
      const provider = createJiraProvider({
        decl: jiraDecl(),
        credential: 'api-token',
        fetch: recorded(testCase.reply),
        now: NOW,
      });

      // No try/catch: a throw here fails the test, which is the assertion.
      const result = await provider.readState(JIRA_CTX, ITEM_KEY);
      expect(reasonOf(result)).toBe(testCase.reason);
      expect(messageOf(result).length).toBeGreaterThan(0);
    });
  }

  it('names the provider and the remedy when the credential is rejected (Principle V)', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ status: 401, body: { errorMessages: ['Client must be authenticated'] } }),
      now: NOW,
    });

    const message = messageOf(await provider.readState(JIRA_CTX, ITEM_KEY));
    expect(message).toContain(TRACKER);
    expect(message).toContain('Settings');
  });

  it('passes the retry window through when the site supplies one (Principle X)', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ status: 429, body: {}, headers: { 'retry-after': '30' } }),
      now: NOW,
    });

    expect(messageOf(await provider.readState(JIRA_CTX, ITEM_KEY))).toContain('30');
  });

  it('reports every read as a failure rather than throwing, for one unreachable site', async () => {
    // FR-037: one failing provider must not take down unrelated parts of the
    // dashboard. That is only true if each method returns rather than throws.
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ throws: new Error('fetch failed') }),
      now: NOW,
    });

    const results = [
      await provider.discoverItems(JIRA_CTX),
      await provider.readState(JIRA_CTX, ITEM_KEY),
      await provider.readArtifact(JIRA_CTX, trackerArtifact, ITEM_KEY),
      await provider.readGate(JIRA_CTX, fieldGate, ITEM_KEY),
    ];
    expect(results.map(reasonOf)).toEqual(['unreachable', 'unreachable', 'unreachable', 'unreachable']);
  });

  it('reports an unreachable site through health() rather than throwing', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ throws: new Error('fetch failed') }),
      now: NOW,
    });

    expect((await provider.health()).status).toBe('unreachable');
  });
});

describe('rule 1: GitHub turns every expected failure into a typed Result', () => {
  for (const testCase of GITHUB_STATUS_CASES) {
    it(`reports ${testCase.what} as ${testCase.reason}, without throwing`, async () => {
      const provider = createGithubProvider({
        decl: githubDecl(),
        credential: 'gh-token',
        fetch: recorded(testCase.reply),
        now: NOW,
      });

      const result = await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY);
      expect(reasonOf(result)).toBe(testCase.reason);
      expect(messageOf(result).length).toBeGreaterThan(0);
    });
  }

  it('reports every read as a failure rather than throwing, for one unreachable API', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ throws: new Error('fetch failed') }),
      now: NOW,
    });

    const results = [
      await provider.discoverItems(GITHUB_CTX),
      await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY),
      await provider.readGate(GITHUB_CTX, checkGate(CHECK_NAME), GITHUB_ITEM_KEY),
    ];
    expect(results.map(reasonOf)).toEqual(['unreachable', 'unreachable', 'unreachable']);
  });

  it('explains a 404 as possibly-private rather than as certainly-absent (Principle V)', async () => {
    // GitHub answers 404 both for a deleted repository and for one the token
    // cannot see. An error that says only "not found" sends the engineer looking
    // for the wrong problem.
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ status: 404, body: { message: 'Not Found' } }),
      now: NOW,
    });

    expect(messageOf(await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY))).toContain('private');
  });

  it('reports an inaccessible repository through health() as an access problem', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ status: 404, body: { message: 'Not Found' } }),
      now: NOW,
    });

    const health = await provider.health();
    expect(health.status).toBe('unauthenticated');
    expect(health.message).toContain('acme/parcels');
  });

  it('reports a healthy API through health() when the recorded repository parses', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ body: GITHUB_REPOSITORY }),
      now: NOW,
    });

    expect((await provider.health()).status).toBe('ok');
  });

  it('reports a healthy site through health() when Jira’s recorded account parses', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: JIRA_MYSELF }),
      now: NOW,
    });

    expect((await provider.health()).status).toBe('ok');
  });

  it('does not treat the first failing request in a multi-request read as a throw', async () => {
    // `readArtifact` reads the issue and then its comments. The second request
    // failing must degrade the same way the first would.
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recordedSequence([{ body: GITHUB_ISSUE }, { status: 500, body: { message: 'Server Error' } }]),
      now: NOW,
    });

    const result = await provider.readArtifact(
      GITHUB_CTX,
      { ...trackerArtifact, provider: CHECKS },
      GITHUB_ITEM_KEY,
    );
    expect(reasonOf(result)).toBe('unreachable');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Rule 6 — absent by default: unconfigured names what is missing
// ═════════════════════════════════════════════════════════════════════════════

describe('rule 6 (FR-026, FR-035): an unconfigured provider reports what it needs', () => {
  it('Jira: every read returns not_configured when no credential is set', async () => {
    const provider = createJiraProvider({
      decl: jiraDecl(),
      fetch: forbiddenFetch(),
      now: NOW,
    });

    const results = [
      await provider.discoverItems(JIRA_CTX),
      await provider.readState(JIRA_CTX, ITEM_KEY),
      await provider.readArtifact(JIRA_CTX, trackerArtifact, ITEM_KEY),
      await provider.readGate(JIRA_CTX, fieldGate, ITEM_KEY),
      await provider.readGate(JIRA_CTX, checkGate(CHECK_NAME), ITEM_KEY),
    ];
    expect(results.map(reasonOf)).toEqual([
      'not_configured',
      'not_configured',
      'not_configured',
      'not_configured',
      'not_configured',
    ]);
  });

  it('Jira: an unconfigured provider makes no request at all', async () => {
    // "Absent by default" has to mean absent, not "tries anyway and fails". A
    // zero-credential launch must reach no network (Principle I).
    const calls: RecordedCall[] = [];
    const provider = createJiraProvider({
      decl: jiraDecl(),
      fetch: recorded({ body: JIRA_ISSUE_STATUS }, calls),
      now: NOW,
    });

    await provider.readState(JIRA_CTX, ITEM_KEY);
    await provider.health();
    expect(calls).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('Jira: health() names the missing credential', async () => {
    const provider = createJiraProvider({ decl: jiraDecl(), fetch: forbiddenFetch(), now: NOW });

    const health = await provider.health();
    expect(health.status).toBe('not_configured');
    expect(health.message).toContain(TRACKER);
    expect(health.message).toContain('API token');
  });

  it('Jira: health() names every missing setting, not just the first', async () => {
    // FR-026 asks which providers a configuration requires and which are not
    // configured. One name at a time turns setup into a guessing game.
    const provider = createJiraProvider({ decl: jiraDecl({}), fetch: forbiddenFetch(), now: NOW });

    const health = await provider.health();
    expect(health.status).toBe('not_configured');
    expect(health.message).toContain('base_url');
    expect(health.message).toContain('email');
    expect(health.message).toContain('API token');
  });

  it('GitHub: every read returns not_configured when no token is set', async () => {
    const provider = createGithubProvider({
      decl: githubDecl(),
      fetch: forbiddenFetch(),
      now: NOW,
    });

    const results = [
      await provider.discoverItems(GITHUB_CTX),
      await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY),
      await provider.readArtifact(GITHUB_CTX, { ...trackerArtifact, provider: CHECKS }, GITHUB_ITEM_KEY),
      await provider.readGate(GITHUB_CTX, checkGate(CHECK_NAME), GITHUB_ITEM_KEY),
    ];
    expect(results.map(reasonOf)).toEqual([
      'not_configured',
      'not_configured',
      'not_configured',
      'not_configured',
    ]);
  });

  it('GitHub: an unconfigured provider makes no request at all', async () => {
    const calls: RecordedCall[] = [];
    const provider = createGithubProvider({
      decl: githubDecl(),
      fetch: recorded({ body: GITHUB_REPOSITORY }, calls),
      now: NOW,
    });

    await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY);
    await provider.health();
    expect(calls).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('GitHub: health() names every missing setting and the missing token', async () => {
    const provider = createGithubProvider({ decl: githubDecl({}), fetch: forbiddenFetch(), now: NOW });

    const health = await provider.health();
    expect(health.status).toBe('not_configured');
    expect(health.message).toContain(CHECKS);
    expect(health.message).toContain('owner');
    expect(health.message).toContain('repo');
    expect(health.message).toContain('access token');
  });

  it('reports not_configured rather than unreachable, so the fix offered is configuration', async () => {
    // The two read identically from a distance and lead to opposite actions: one
    // sends the engineer to Settings, the other to the network.
    const jira = createJiraProvider({ decl: jiraDecl(), fetch: forbiddenFetch(), now: NOW });
    const github = createGithubProvider({ decl: githubDecl(), fetch: forbiddenFetch(), now: NOW });

    expect(reasonOf(await jira.readState(JIRA_CTX, ITEM_KEY))).toBe('not_configured');
    expect(reasonOf(await github.readState(GITHUB_CTX, GITHUB_ITEM_KEY))).toBe('not_configured');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The endpoints themselves — evidence the recordings above are the right ones
// ═════════════════════════════════════════════════════════════════════════════

describe('the recorded fixtures are addressed to the endpoints the providers call', () => {
  it('Jira reads a status from the v3 issue endpoint', async () => {
    const calls: RecordedCall[] = [];
    const provider = createJiraProvider({
      decl: jiraDecl(),
      credential: 'api-token',
      fetch: recorded({ body: JIRA_ISSUE_STATUS }, calls),
      now: NOW,
    });

    await provider.readState(JIRA_CTX, ITEM_KEY);
    expect(calls[0]?.url).toBe(`${JIRA_SITE}/rest/api/3/issue/${ITEM_KEY}?fields=status`);
  });

  it('GitHub reads check runs for a ref, filtered to the declared check name', async () => {
    const calls: RecordedCall[] = [];
    const provider = createGithubProvider({
      decl: githubDecl(),
      credential: 'gh-token',
      fetch: recorded({ body: githubCheckRuns(checkRun('completed', 'success')) }, calls),
      now: NOW,
    });

    await provider.readGate(GITHUB_CTX, checkGate(CHECK_NAME), GITHUB_ITEM_KEY);
    const url = calls[0]?.url ?? '';
    expect(url).toContain('https://api.github.com/repos/acme/parcels/commits/HEAD/check-runs');
    expect(url).toContain(`check_name=${CHECK_NAME}`);
  });
});
