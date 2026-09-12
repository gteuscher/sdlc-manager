/**
 * T032 — no credential escapes a remote provider (provider-interface.md rule 4,
 * Constitution Principle III: credentials "MUST NEVER be written to logs or
 * telemetry").
 *
 * The failure this defends against is not malice, it is convenience. The most
 * natural way to make a 401 debuggable is to include the request that produced
 * it, and the request carries the credential. So every failure path is driven
 * here with a distinctive sentinel token, and the token is then looked for in the
 * three places it could escape to:
 *
 *   1. the serialised `Result` — which crosses the IPC surface and is rendered;
 *   2. any `console.*` line — every channel is spied on, not just `error`;
 *   3. any thrown value — an exception carrying a token ends up in a crash report.
 *
 * A fourth is asserted separately and matters most in practice: the token must
 * never appear in a request **URL**. A URL is the part of a request that is
 * logged by proxies, written into server access logs, and printed by network
 * tooling, none of which the credential's owner controls. It belongs in a header.
 *
 * For Jira the derived HTTP Basic blob counts as the credential too: it is
 * base64, not encryption, and `email:token` is recoverable from it by anyone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArtifactDecl, GateDecl, ProviderDecl, SdlcDefinition } from '@core/model/declared';
import type { RepoContext } from '@providers/contract';
import { createGithubProvider } from '@providers/github/index';
import { createJiraProvider } from '@providers/jira/index';

import { gate, lifecycle } from '../support/lifecycle';

// ── The sentinel ─────────────────────────────────────────────────────────────

/** Distinctive enough that any occurrence anywhere is this credential and nothing else. */
const SENTINEL = 'sentinel-9f3a7b21-c0ffee-DO-NOT-LOG';

const JIRA_SITE = 'https://parcels.example.invalid';
const JIRA_EMAIL = 'dana@parcels.example.invalid';

/** What Jira actually sends: `Basic base64(email:token)`. Reversible, so it is a secret. */
const JIRA_BASIC_BLOB = Buffer.from(`${JIRA_EMAIL}:${SENTINEL}`, 'utf8').toString('base64');
const JIRA_AUTHORIZATION = `Basic ${JIRA_BASIC_BLOB}`;
const GITHUB_AUTHORIZATION = `Bearer ${SENTINEL}`;

/** Every string that must not surface. The derived forms leak just as badly as the raw one. */
const FORBIDDEN: readonly string[] = [SENTINEL, JIRA_BASIC_BLOB];

function assertNoSecret(where: string, haystack: string): void {
  for (const secret of FORBIDDEN) {
    if (haystack.includes(secret)) {
      throw new Error(`${where} leaked a credential: found "${secret.slice(0, 16)}…" in ${haystack}`);
    }
  }
  expect(haystack).not.toContain(SENTINEL);
}

// ── Harness ──────────────────────────────────────────────────────────────────

type FetchLike = typeof globalThis.fetch;

interface Reply {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly throws?: Error;
}

interface Attempt {
  readonly url: string;
  readonly authorization: string;
}

function recorded(reply: Reply, attempts: Attempt[] = []): FetchLike {
  const impl: FetchLike = async (input, init) => {
    const headers = new Headers(init?.headers);
    attempts.push({ url: String(input), authorization: headers.get('authorization') ?? '' });
    if (reply.throws !== undefined) throw reply.throws;
    const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? null);
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers ?? {} });
  };
  return impl;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Every console channel, because a leak into `debug` is a leak. */
function spyEveryConsoleChannel(): () => string {
  const captured: string[] = [];
  const spies = [
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'debug'),
    vi.spyOn(console, 'trace'),
  ];
  for (const spy of spies) {
    spy.mockImplementation((...args: unknown[]) => {
      captured.push(args.map(stringify).join(' '));
    });
  }
  return () => captured.join('\n');
}

interface Outcome {
  /** Everything the caller can see: the serialised results and any thrown value. */
  readonly returned: string;
  readonly thrown: readonly string[];
}

/** Calls a set of thunks, recording what each returned or threw. Nothing propagates. */
async function exercise(calls: readonly (() => Promise<unknown>)[]): Promise<Outcome> {
  const returned: unknown[] = [];
  const thrown: string[] = [];
  for (const call of calls) {
    try {
      returned.push(await call());
    } catch (error) {
      thrown.push(stringify(error));
    }
  }
  return { returned: returned.map(stringify).join('\n'), thrown };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('a live network call was attempted from a unit test');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── The lifecycle under test ─────────────────────────────────────────────────

const TRACKER = 'tracker';
const CHECKS = 'checks';
const ITEM_KEY = 'PARCEL-7';
const GITHUB_ITEM_KEY = 'acme/parcels#7';

const jiraDecl: ProviderDecl = {
  id: TRACKER,
  kind: 'jira',
  settings: { base_url: JIRA_SITE, email: JIRA_EMAIL },
};

const githubDecl: ProviderDecl = {
  id: CHECKS,
  kind: 'github',
  settings: { owner: 'acme', repo: 'parcels' },
};

function definitionOwnedBy(owner: string, decl: ProviderDecl): SdlcDefinition {
  const base = lifecycle({
    owner,
    providers: [decl],
    states: [
      { id: 'intake', maps: { [owner]: ['Logged', 'open'] } },
      { id: 'settled', terminal: true, maps: { [owner]: ['Closed', 'closed'] } },
    ],
  });
  return {
    ...base,
    items: { ...base.items, discover: [{ provider: owner, query: 'assignee = currentUser()' }] },
  };
}

const JIRA_CTX: RepoContext = {
  repositoryId: 'repo-parcels',
  repositoryPath: '/not/read/by/a/remote/provider',
  definition: definitionOwnedBy(TRACKER, jiraDecl),
  config: {},
};

const GITHUB_CTX: RepoContext = {
  repositoryId: 'repo-parcels',
  repositoryPath: '/not/read/by/a/remote/provider',
  definition: definitionOwnedBy(CHECKS, githubDecl),
  config: {},
};

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

const checkGate: GateDecl = {
  ...gate({ id: 'weighed', kind: 'check' }),
  locator: { check: 'weigh-bridge' },
};

// ── The failure paths, each one a way a credential could escape ──────────────

interface Path {
  readonly what: string;
  readonly jira: Reply;
  readonly github: Reply;
}

/**
 * Every branch that produces a message. The bodies deliberately echo the
 * credential back, because several real APIs do: an error handler that repeats
 * the offending request is the ordinary way a gateway explains a rejection.
 */
const PATHS: readonly Path[] = [
  {
    what: 'an authentication failure whose body repeats the Authorization header',
    jira: {
      status: 401,
      body: { errorMessages: [`Rejected credential ${JIRA_AUTHORIZATION} for ${JIRA_EMAIL}`] },
    },
    github: { status: 401, body: { message: `Bad credentials: ${GITHUB_AUTHORIZATION}` } },
  },
  {
    what: 'a rate limit',
    jira: {
      status: 429,
      body: { errorMessages: [`Rate limit for token ${SENTINEL}`] },
      headers: { 'retry-after': '30' },
    },
    github: {
      status: 429,
      body: { message: `Secondary rate limit for token ${SENTINEL}` },
      headers: { 'retry-after': '45' },
    },
  },
  {
    what: 'a 4xx whose body echoes the whole request',
    jira: {
      status: 400,
      body: {
        errorMessages: [`Bad request`],
        errors: { request: `GET /rest/api/3/issue authorization=${JIRA_AUTHORIZATION}` },
      },
    },
    github: {
      status: 422,
      body: {
        message: 'Validation failed',
        errors: [{ field: 'authorization', code: 'invalid', message: GITHUB_AUTHORIZATION }],
      },
    },
  },
  {
    what: 'a 4xx whose body is not even JSON and repeats the request verbatim',
    jira: { status: 403, body: `<html>forbidden: authorization: ${JIRA_AUTHORIZATION}</html>` },
    github: { status: 403, body: `forbidden: authorization: ${GITHUB_AUTHORIZATION}` },
  },
  {
    what: 'a 404 whose body echoes the credential',
    jira: { status: 404, body: { errorMessages: [`No issue for ${SENTINEL}`] } },
    github: { status: 404, body: { message: `Not Found for ${SENTINEL}` } },
  },
  {
    what: 'a 5xx whose body echoes the credential',
    jira: { status: 503, body: `upstream refused ${JIRA_AUTHORIZATION}` },
    github: { status: 500, body: { message: `upstream refused ${GITHUB_AUTHORIZATION}` } },
  },
  {
    what: 'a response that no longer matches its schema and carries the credential in it',
    jira: { status: 200, body: { key: ITEM_KEY, echo: SENTINEL, fields: { statusValue: {} } } },
    github: { status: 200, body: { number: 7, echo: SENTINEL, state: 1 } },
  },
  {
    what: 'a body that is not JSON at all and carries the credential in it',
    jira: { status: 200, body: `<html>${JIRA_AUTHORIZATION}</html>` },
    github: { status: 200, body: `<html>${GITHUB_AUTHORIZATION}</html>` },
  },
  {
    what: 'a fetch that throws with the credential in the error and in its cause',
    jira: {
      throws: Object.assign(new Error(`fetch failed for authorization ${JIRA_AUTHORIZATION}`), {
        cause: new Error(`socket closed while sending ${SENTINEL}`),
      }),
    },
    github: {
      throws: Object.assign(new Error(`fetch failed for authorization ${GITHUB_AUTHORIZATION}`), {
        cause: new Error(`socket closed while sending ${SENTINEL}`),
      }),
    },
  },
];

function jiraCalls(reply: Reply, attempts: Attempt[] = []): (() => Promise<unknown>)[] {
  const provider = createJiraProvider({
    decl: jiraDecl,
    credential: SENTINEL,
    fetch: recorded(reply, attempts),
  });
  return [
    () => provider.health(),
    () => provider.discoverItems(JIRA_CTX),
    () => provider.readState(JIRA_CTX, ITEM_KEY),
    () => provider.readArtifact(JIRA_CTX, trackerArtifact, ITEM_KEY),
    () => provider.readGate(JIRA_CTX, fieldGate, ITEM_KEY),
    () => provider.readGate(JIRA_CTX, checkGate, ITEM_KEY),
  ];
}

function githubCalls(reply: Reply, attempts: Attempt[] = []): (() => Promise<unknown>)[] {
  const provider = createGithubProvider({
    decl: githubDecl,
    credential: SENTINEL,
    fetch: recorded(reply, attempts),
  });
  return [
    () => provider.health(),
    () => provider.discoverItems(GITHUB_CTX),
    () => provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY),
    () => provider.readArtifact(GITHUB_CTX, { ...trackerArtifact, provider: CHECKS }, GITHUB_ITEM_KEY),
    () => provider.readGate(GITHUB_CTX, checkGate, GITHUB_ITEM_KEY),
  ];
}

// ═════════════════════════════════════════════════════════════════════════════

describe('the leak detector itself', () => {
  it('would notice a credential written to any console channel', () => {
    // Without this, every console assertion below could be passing vacuously —
    // and a vacuous assertion about a secret is worse than none, because it reads
    // like proof.
    const output = spyEveryConsoleChannel();
    console.debug('a stray diagnostic', { authorization: GITHUB_AUTHORIZATION });
    console.trace(`token=${SENTINEL}`);
    expect(output()).toContain(SENTINEL);
    expect(() => {
      assertNoSecret('the detector', output());
    }).toThrow();
  });

  it('would notice the derived Basic blob, not only the raw token', () => {
    const output = spyEveryConsoleChannel();
    console.warn(JIRA_AUTHORIZATION);
    expect(() => {
      assertNoSecret('the detector', output());
    }).toThrow();
    // The blob is base64 of `email:token`, so treating it as harmless would be
    // treating the credential as harmless.
    expect(Buffer.from(JIRA_BASIC_BLOB, 'base64').toString('utf8')).toContain(SENTINEL);
  });
});

describe('rule 4: the Jira provider never surfaces its credential', () => {
  for (const path of PATHS) {
    it(`keeps the credential out of every surface for ${path.what}`, async () => {
      const output = spyEveryConsoleChannel();
      const outcome = await exercise(jiraCalls(path.jira));

      assertNoSecret('a returned Result', outcome.returned);
      assertNoSecret('a console line', output());
      // Rule 1 first: nothing may throw at all. A thrown value is both a
      // blast-radius failure and the least controllable place a secret can land.
      expect(outcome.thrown).toEqual([]);
    });
  }
});

describe('rule 4: the GitHub provider never surfaces its credential', () => {
  for (const path of PATHS) {
    it(`keeps the credential out of every surface for ${path.what}`, async () => {
      const output = spyEveryConsoleChannel();
      const outcome = await exercise(githubCalls(path.github));

      assertNoSecret('a returned Result', outcome.returned);
      assertNoSecret('a console line', output());
      expect(outcome.thrown).toEqual([]);
    });
  }
});

describe('the credential travels in a header and never in a URL', () => {
  it('Jira sends the credential as an Authorization header and puts none of it in the URL', async () => {
    // A URL is logged by every proxy between here and the site, and by the site's
    // own access log. A header is not.
    const attempts: Attempt[] = [];
    await exercise(jiraCalls({ status: 200, body: { key: ITEM_KEY, fields: { status: { name: 'Logged' } } } }, attempts));

    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) {
      assertNoSecret('a request URL', attempt.url);
      assertNoSecret('a request URL', decodeURIComponent(attempt.url));
      expect(attempt.authorization).toBe(JIRA_AUTHORIZATION);
    }
  });

  it('GitHub sends the credential as a Bearer header and puts none of it in the URL', async () => {
    const attempts: Attempt[] = [];
    await exercise(githubCalls({ status: 200, body: { total_count: 0, check_runs: [] } }, attempts));

    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) {
      assertNoSecret('a request URL', attempt.url);
      assertNoSecret('a request URL', decodeURIComponent(attempt.url));
      expect(attempt.authorization).toBe(GITHUB_AUTHORIZATION);
    }
  });
});

describe('health reporting names the provider without naming the secret', () => {
  it('Jira health() reports a rejected credential without quoting it', async () => {
    const output = spyEveryConsoleChannel();
    const provider = createJiraProvider({
      decl: jiraDecl,
      credential: SENTINEL,
      fetch: recorded({ status: 401, body: { errorMessages: [`rejected ${JIRA_AUTHORIZATION}`] } }),
    });

    const health = await provider.health();
    expect(health.status).toBe('unauthenticated');
    // Still actionable (Principle V): it says which provider, just not what the
    // secret is.
    expect(health.message).toContain(TRACKER);
    assertNoSecret('a ProviderHealth message', stringify(health));
    assertNoSecret('a console line', output());
  });

  it('GitHub health() reports a rejected token without quoting it', async () => {
    const output = spyEveryConsoleChannel();
    const provider = createGithubProvider({
      decl: githubDecl,
      credential: SENTINEL,
      fetch: recorded({ status: 401, body: { message: `Bad credentials ${GITHUB_AUTHORIZATION}` } }),
    });

    const health = await provider.health();
    expect(health.status).toBe('unauthenticated');
    expect(health.message).toContain(CHECKS);
    assertNoSecret('a ProviderHealth message', stringify(health));
    assertNoSecret('a console line', output());
  });

  it('an unconfigured provider names what is missing without inventing a credential to show', async () => {
    const output = spyEveryConsoleChannel();
    const provider = createJiraProvider({
      decl: jiraDecl,
      fetch: recorded({ status: 200, body: {} }),
    });

    const health = await provider.health();
    expect(health.status).toBe('not_configured');
    assertNoSecret('a ProviderHealth message', stringify(health));
    assertNoSecret('a console line', output());
  });
});

describe('the redaction is a redaction, not an accident of short messages', () => {
  it('Jira replaces the credential with a marker rather than dropping the whole explanation', async () => {
    // If a leak were prevented by discarding the body entirely, the engineer would
    // lose the site's explanation along with the secret. The excerpt must survive.
    const provider = createJiraProvider({
      decl: jiraDecl,
      credential: SENTINEL,
      fetch: recorded({
        status: 401,
        body: { errorMessages: [`Credential ${JIRA_AUTHORIZATION} is expired; regenerate it`] },
      }),
    });

    const result = await provider.readState(JIRA_CTX, ITEM_KEY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    assertNoSecret('a Result message', result.message);
    expect(result.message).toContain('expired');
    expect(result.message).toContain('[redacted]');
  });

  it('GitHub replaces the credential with a marker rather than dropping the whole explanation', async () => {
    const provider = createGithubProvider({
      decl: githubDecl,
      credential: SENTINEL,
      fetch: recorded({
        status: 401,
        body: { message: `Token ${SENTINEL} was revoked; create a new one` },
      }),
    });

    const result = await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    assertNoSecret('a Result message', result.message);
    expect(result.message).toContain('revoked');
    expect(result.message).toContain('[redacted]');
  });

  it('redacts a credential that arrives split across several echoed fields', async () => {
    const provider = createGithubProvider({
      decl: githubDecl,
      credential: SENTINEL,
      fetch: recorded({
        status: 422,
        body: {
          message: `Validation failed for ${SENTINEL}`,
          errors: [
            { field: 'authorization', code: 'custom', message: GITHUB_AUTHORIZATION },
            { field: 'token', code: 'custom', message: SENTINEL },
          ],
        },
      }),
    });

    const result = await provider.readState(GITHUB_CTX, GITHUB_ITEM_KEY);
    assertNoSecret('a Result message', stringify(result));
  });
});
