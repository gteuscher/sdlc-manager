/**
 * T024–T026 — the shared body of every provider fake.
 *
 * `tests/parity/` runs the engine's behavioural suite against each fake in turn.
 * A test that passes for one fake and fails for another does not mean the fakes
 * disagree; it means provider-specific knowledge has leaked into the engine
 * (Principle IV, provider-interface.md §3). That diagnostic only works if the
 * fakes are behaviourally identical, so **all** of the behaviour lives here and
 * `filesystem.fake.ts`, `jira.fake.ts` and `github.fake.ts` differ only in their
 * `kind`, their advisory fault vocabulary, and their exported factory name.
 *
 * The rules from provider-interface.md §2 hold here exactly as they do for a live
 * adapter:
 *   1. no throw for an expected failure — every one is a typed `Result` failure;
 *   2. no mapping — a fake returns the seeded raw vocabulary and never a state id;
 *   3. validation at the boundary — every response is parsed before it leaves;
 *   4. no credential is read, logged, or returned — `options.credential` is never
 *      touched below;
 *   5. absence is never success — an unseeded gate is `not_evaluated`, never
 *      `passed`.
 *
 * All state lives in the closure `createFakeProvider` returns. There is no
 * module-level mutable state and no import-time side effect (Principle VIII).
 */

import { z } from 'zod';

import type { Locator } from '@core/model/declared.js';
import type {
  ArtifactContent,
  GateResult,
  ItemKey,
  ProviderHealth,
  ProviderHealthStatus,
} from '@core/model/observed.js';
import type { Failure, Result } from '@core/model/result.js';
import { fail, ok } from '@core/model/result.js';

import type {
  ArtifactDecl,
  GateDecl,
  Provider,
  ProviderId,
  ProviderKind,
  ProviderOptions,
  RawItem,
  RawState,
  RepoContext,
  Unsubscribe,
} from '../contract.js';
import { healthy, notEvaluated, nowIso, unconfigured } from '../contract.js';

/**
 * The branches the engine's error paths need and that a live system will not
 * produce on request (provider-interface.md §3).
 *
 * `unreachable`, `unauthenticated`, `rate_limited` and `not_configured` are
 * connectivity faults: they fail *every* read. `missing_artifact` and
 * `gate_unevaluated` are read-level faults, scoped to `readArtifact` and
 * `readGate` respectively — the provider itself stays healthy under them, because
 * a missing file is not a broken connection.
 */
export type FakeFault =
  | 'none'
  | 'unreachable'
  | 'unauthenticated'
  | 'rate_limited'
  | 'missing_artifact'
  | 'gate_unevaluated'
  | 'not_configured';

export interface FakeItemSeed {
  key: string;
  title: string;
  rawState: string;
  assignee?: string;
  /** Identity fields for `{item.<field>}` templating. */
  fields?: Record<string, string>;
  /** artifactId -> content text. */
  artifacts?: Record<string, string>;
  /** gateId -> status. Structurally identical to `GateStatus`. */
  gates?: Record<string, 'passed' | 'failed' | 'not_evaluated'>;
}

export interface FakeSeed {
  items: FakeItemSeed[];
}

export interface FakeControls {
  /** Produce a branch on demand: healthy, unreachable, unauthenticated, rate limited, missing artifact, gate with no recorded result. */
  setFault(fault: FakeFault): void;
  /** Fire every subscriber, as a watch or a poll tick would. */
  emitChange(): void;
}

export interface FakeOptions extends ProviderOptions {
  seed?: FakeSeed;
}

/**
 * The cap above which a seeded artifact is reported as truncated (FR-021).
 * A frozen literal, not mutable state.
 */
const MAX_ARTIFACT_BYTES = 64 * 1024;

/**
 * A small, lifecycle-agnostic seed.
 *
 * Returned fresh on every call so two fakes can never share — and so mutate —
 * one object. It deliberately names no state, gate, or artifact from any real
 * manifest: the raw values below are whatever a caller's `maps` block says they
 * are, and a parity suite supplies its own seed when it needs specific ones.
 *
 * The three items cover the three shapes the engine has to handle: a complete
 * item, an item whose gate failed, and an item with nothing recorded at all.
 */
export function defaultFakeSeed(): FakeSeed {
  return {
    items: [
      {
        key: 'ITEM-1',
        title: 'First seeded item',
        rawState: 'raw-state-a',
        assignee: 'seeded-engineer',
        fields: { id: '1', slug: 'first-seeded-item' },
        artifacts: { 'artifact-a': '# First seeded item\n\nSeeded artifact content.\n' },
        gates: { 'gate-a': 'passed' },
      },
      {
        key: 'ITEM-2',
        title: 'Second seeded item',
        rawState: 'raw-state-b',
        assignee: 'seeded-engineer',
        fields: { id: '2', slug: 'second-seeded-item' },
        artifacts: { 'artifact-a': '# Second seeded item\n\nSeeded artifact content.\n' },
        gates: { 'gate-a': 'failed' },
      },
      {
        // Nothing seeded: every artifact read is `not_found` and every gate read
        // is `not_evaluated`. Absence is never success (FR-014).
        key: 'ITEM-3',
        title: 'Third seeded item',
        rawState: 'raw-state-c',
        fields: { id: '3', slug: 'third-seeded-item' },
      },
    ],
  };
}

/* ── Boundary schemas (provider-interface.md rule 3) ─────────────────────────
   Every response is parsed before it leaves the provider. A response that does
   not match its schema is an `invalid_response` failure, not a throw. */

const evidenceSchema = z.object({
  provider: z.string().min(1),
  locator: z.string(),
});

const rawItemSchema = z.object({
  key: z.string().min(1),
  title: z.string().optional(),
  rawState: z.string().optional(),
  assignee: z.string().optional(),
  source: z.string().min(1),
  fields: z.record(z.string(), z.string()),
});

const rawItemsSchema = z.array(rawItemSchema);

const rawStateSchema = z.object({
  value: z.string(),
  observedAt: z.string().min(1),
});

const artifactContentSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.string().min(1),
  provider: z.string().min(1),
  locator: z.string(),
  content: z.string(),
  reconciledAt: z.string().min(1),
  truncated: z.boolean(),
  byteLength: z.number().int().nonnegative(),
});

const gateResultSchema = z
  .object({
    gateId: z.string().min(1),
    status: z.enum(['passed', 'failed', 'not_evaluated']),
    evaluatedAt: z.string().min(1).nullable(),
    evidence: evidenceSchema.nullable(),
    detail: z.string().nullable(),
  })
  // `evaluatedAt` is null exactly when the status is `not_evaluated`.
  .refine(
    (value) => (value.status === 'not_evaluated') === (value.evaluatedAt === null),
    'evaluatedAt must be null exactly when the gate status is not_evaluated',
  );

/**
 * Validates a response against its schema and returns the original typed value.
 *
 * Returning the input rather than the parsed output keeps the declared readonly
 * shapes intact; the schema's job here is to catch a malformed seed at the
 * boundary rather than to reshape anything.
 */
function checked<T>(schema: z.ZodTypeAny, value: T, what: string): Result<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(value);
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
  return fail(
    'invalid_response',
    `${what} did not match its schema${where}: ${issue?.message ?? 'unknown validation error'}. The seed is malformed.`,
  );
}

/* ── Faults ──────────────────────────────────────────────────────────────── */

/**
 * The typed failure a connectivity fault produces, or `undefined` when the fault
 * is not a connectivity one. No message below contains a credential (rule 4).
 */
function connectivityFailure(
  fault: FakeFault,
  providerId: ProviderId,
  operation: string,
): Failure | undefined {
  switch (fault) {
    case 'unreachable':
      return fail(
        'unreachable',
        `${providerId} is unreachable, so ${operation} could not be completed. Check the connection and retry.`,
      );
    case 'unauthenticated':
      return fail(
        'unauthenticated',
        `${providerId} rejected the stored credential, so ${operation} could not be completed. Reconnect ${providerId} and retry.`,
      );
    case 'rate_limited':
      return fail(
        'rate_limited',
        `${providerId} refused ${operation} for quota reasons. Retry in a few minutes.`,
      );
    case 'not_configured':
      return fail(
        'not_configured',
        `${providerId} is not configured, so ${operation} could not be attempted. Add its connection settings to this repository.`,
      );
    default:
      return undefined;
  }
}

function healthStatusFor(fault: FakeFault): ProviderHealthStatus {
  switch (fault) {
    case 'unreachable':
      return 'unreachable';
    case 'unauthenticated':
      return 'unauthenticated';
    case 'rate_limited':
      return 'rate_limited';
    case 'not_configured':
      return 'not_configured';
    // `missing_artifact` and `gate_unevaluated` are read-level faults: the
    // provider is reachable and configured, one read simply has nothing to
    // return.
    default:
      return 'ok';
  }
}

/* ── Locators ────────────────────────────────────────────────────────────── */

/** Substitutes `{item.<field>}`, plus `{item.key}`, in a declared locator. */
function renderTemplate(
  template: string,
  key: ItemKey,
  fields: Readonly<Record<string, string>>,
): string {
  // Constructed per call: a shared global regex would carry `lastIndex` as
  // module-level mutable state (Principle VIII).
  const pattern = /\{item\.([A-Za-z0-9_.-]+)\}/g;
  return template.replace(pattern, (whole, field: string) => {
    if (field === 'key') return key;
    const value = fields[field];
    return value === undefined ? whole : value;
  });
}

/** A display-only locator string. The renderer can never resolve it (ipc-surface.md rule 4). */
function locatorText(
  locator: Locator | undefined,
  key: ItemKey,
  fields: Readonly<Record<string, string>>,
  fallback: string,
): string {
  const raw = locator?.path ?? locator?.field ?? locator?.check ?? locator?.run ?? fallback;
  return renderTemplate(raw, key, fields);
}

/* ── Artifact content ────────────────────────────────────────────────────── */

/**
 * `byteLength` describes the content actually returned, and `truncated` says
 * whether the seeded artifact was longer than the cap. Both are measured, never
 * assumed (FR-021).
 */
function clampArtifact(text: string): { content: string; truncated: boolean; byteLength: number } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= MAX_ARTIFACT_BYTES) {
    return { content: text, truncated: false, byteLength: bytes.length };
  }
  const cut = new TextDecoder().decode(bytes.slice(0, MAX_ARTIFACT_BYTES));
  return { content: cut, truncated: true, byteLength: encoder.encode(cut).length };
}

/* ── The fake ────────────────────────────────────────────────────────────── */

/**
 * Builds a provider fake of the given kind.
 *
 * `options.credential` is never read. It exists on `ProviderOptions` because a
 * live adapter needs one; a fake that stored it could only ever leak it.
 */
export function createFakeProvider(
  kind: ProviderKind,
  options: FakeOptions,
): Provider & FakeControls {
  const id: ProviderId = options.decl.id;
  const now = options.now;
  const seed: FakeSeed = options.seed ?? defaultFakeSeed();

  // Closure state. Nothing below is visible to another fake instance.
  const itemsByKey = new Map<string, FakeItemSeed>();
  for (const item of seed.items) itemsByKey.set(item.key, item);

  let fault: FakeFault = 'none';
  const subscribers = new Set<() => void>();

  const fieldsOf = (item: FakeItemSeed): Readonly<Record<string, string>> => ({
    ...(item.fields ?? {}),
  });

  const unknownItem = (key: ItemKey, what: string): Failure =>
    fail('not_found', `${id} has no item ${key}, so ${what} could not be read.`);

  return {
    id,
    kind,

    /** Reflects the current fault. Never throws; reports instead. */
    async health(): Promise<ProviderHealth> {
      const status = healthStatusFor(fault);
      if (status === 'ok') return healthy(id, kind, now);
      if (status === 'not_configured') {
        return unconfigured(id, kind, 'no connection settings are recorded for this repository', now);
      }
      const message =
        status === 'unreachable'
          ? `${id} is unreachable. Check the connection and retry.`
          : status === 'unauthenticated'
            ? `${id} rejected the stored credential. Reconnect ${id} and retry.`
            : `${id} is rate limited. Retry in a few minutes.`;
      return { providerId: id, kind, status, message, checkedAt: nowIso(now) };
    },

    /**
     * The seeded items, in seed order, in the system's raw vocabulary. No value
     * below is mapped to a state id — that is the engine's job (rule 2).
     */
    async discoverItems(_ctx: RepoContext): Promise<Result<RawItem[]>> {
      const failure = connectivityFailure(fault, id, 'discovering items');
      if (failure) return failure;

      const items: RawItem[] = [];
      for (const item of itemsByKey.values()) {
        items.push({
          key: item.key,
          title: item.title,
          rawState: item.rawState,
          ...(item.assignee !== undefined ? { assignee: item.assignee } : {}),
          source: id,
          fields: fieldsOf(item),
        });
      }
      return checked(rawItemsSchema, items, `the item list from ${id}`);
    },

    async readState(_ctx: RepoContext, key: ItemKey): Promise<Result<RawState>> {
      const failure = connectivityFailure(fault, id, `reading the status of ${key}`);
      if (failure) return failure;

      const item = itemsByKey.get(key);
      if (!item) return unknownItem(key, 'its status');

      const state: RawState = { value: item.rawState, observedAt: nowIso(now) };
      return checked(rawStateSchema, state, `the status of ${key} from ${id}`);
    },

    async readArtifact(
      _ctx: RepoContext,
      decl: ArtifactDecl,
      key: ItemKey,
    ): Promise<Result<ArtifactContent>> {
      const name = decl.name || decl.id;
      const failure = connectivityFailure(fault, id, `reading the artifact "${name}" for ${key}`);
      if (failure) return failure;

      const item = itemsByKey.get(key);
      if (!item) return unknownItem(key, `the artifact "${name}"`);

      const seeded = fault === 'missing_artifact' ? undefined : item.artifacts?.[decl.id];
      if (seeded === undefined) {
        return fail(
          'not_found',
          `The artifact "${name}" does not exist for ${key} in ${id}. Create it, or mark it optional in the lifecycle package.`,
          { field: decl.id },
        );
      }

      const fields = fieldsOf(item);
      const clamped = clampArtifact(seeded);
      const content: ArtifactContent = {
        artifactId: decl.id,
        kind: decl.kind,
        provider: id,
        locator: locatorText(decl.locator, key, fields, decl.id),
        // Inert text. Never HTML for injection (ipc-surface.md rule 6, FR-020).
        content: clamped.content,
        reconciledAt: nowIso(now),
        truncated: clamped.truncated,
        byteLength: clamped.byteLength,
      };
      return checked(artifactContentSchema, content, `the artifact "${name}" from ${id}`);
    },

    /**
     * The recorded result for a gate, or `not_evaluated` when nothing is
     * recorded. There is no path below that reaches `passed` without a seeded
     * `passed` — absence is never success (rule 5, FR-014).
     */
    async readGate(_ctx: RepoContext, decl: GateDecl, key: ItemKey): Promise<Result<GateResult>> {
      const name = decl.name || decl.id;
      const failure = connectivityFailure(fault, id, `reading the gate "${name}" for ${key}`);
      if (failure) return failure;

      const item = itemsByKey.get(key);
      if (!item) return unknownItem(key, `the gate "${name}"`);

      const status = fault === 'gate_unevaluated' ? 'not_evaluated' : item.gates?.[decl.id];

      if (status === undefined || status === 'not_evaluated') {
        const detail =
          fault === 'gate_unevaluated'
            ? `${id} has no recorded result for "${name}".`
            : `No result has been recorded for "${name}".`;
        return checked(gateResultSchema, notEvaluated(decl.id, detail), `the gate "${name}" from ${id}`);
      }

      const fields = fieldsOf(item);
      const result: GateResult = {
        gateId: decl.id,
        status,
        evaluatedAt: nowIso(now),
        evidence: {
          provider: id,
          locator: locatorText(decl.locator ?? decl.evidence, key, fields, decl.id),
        },
        detail:
          status === 'passed'
            ? `"${name}" was recorded as passing for ${key}.`
            : `"${name}" was recorded as failing for ${key}.`,
      };
      return checked(gateResultSchema, result, `the gate "${name}" from ${id}`);
    },

    subscribe(_ctx: RepoContext, onChange: () => void): Unsubscribe {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },

    setFault(next: FakeFault): void {
      fault = next;
    },

    emitChange(): void {
      // A snapshot, so a subscriber that unsubscribes during the fan-out cannot
      // disturb it; one that throws must not stop the rest (Principle III).
      for (const subscriber of [...subscribers]) {
        try {
          subscriber();
        } catch {
          // A misbehaving subscriber is the subscriber's bug, not a provider
          // failure, and there is no `Result` to carry it on a void callback.
        }
      }
    },
  };
}
