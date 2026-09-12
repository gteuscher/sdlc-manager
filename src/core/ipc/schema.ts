/**
 * The wire schemas for contracts/ipc-surface.md, and the channel names.
 *
 * These live in `core` rather than in `main/ipc` because **both** sides validate.
 * The renderer is an untrusted producer to the main process, and the main
 * process's replies carry provider data that was itself untrusted — validating
 * only inbound traffic would leave the second hop unchecked (ipc-surface.md
 * rule 2, Principle IX). One schema, parsed at both ends, is the only way that
 * does not drift.
 *
 * Deviation from the contract's `interface` block, recorded rather than hidden:
 * `getItem` and `getArtifact` return `Result` here, where §1 writes them as bare
 * promises. Rule 5 of the same document says every *fallible* call returns a
 * `Result`, and both of these fail routinely — a stale key, a deleted markdown
 * file (FR-019). Rule 5 is the stronger statement, so it wins.
 */

import { z } from 'zod';

// Re-exported so existing consumers have one import, but *defined* in a
// dependency-free module: the sandboxed preload must be able to reach the channel
// names without reaching zod. See channels.ts for why that is load-bearing.
export { CHANNELS } from './channels.js';
export type { Channel } from './channels.js';

// ── Result ──────────────────────────────────────────────────────────────────

export const failureReasonSchema = z.enum([
  'not_found',
  'not_configured',
  'unauthenticated',
  'rate_limited',
  'unreachable',
  'invalid_response',
  'invalid_input',
  'unavailable',
  'conflict',
]);

export const failureSchema = z.object({
  ok: z.literal(false),
  reason: failureReasonSchema,
  message: z.string(),
  field: z.string().optional(),
  line: z.number().optional(),
});

export function resultSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value }), failureSchema]);
}

export const voidResultSchema = resultSchema(z.undefined());

// ── Observed payloads ───────────────────────────────────────────────────────

export const evidenceRefSchema = z.object({
  provider: z.string(),
  locator: z.string(),
});

export const gateResultSchema = z.object({
  gateId: z.string(),
  // Three values. There is no fourth, and no default to passed (FR-014).
  status: z.enum(['passed', 'failed', 'not_evaluated']),
  evaluatedAt: z.string().nullable(),
  evidence: evidenceRefSchema.nullable(),
  detail: z.string().nullable(),
});

export const attentionSignalSchema = z.object({
  kind: z.enum(['input_needed', 'gate_failed']),
  reason: z.string(),
  stateId: z.string().optional(),
  gateId: z.string().optional(),
});

export const providerDisagreementSchema = z.object({
  field: z.string(),
  winner: z.string(),
  winningValue: z.string(),
  others: z.array(z.object({ provider: z.string(), value: z.string() })),
});

export const freshnessSchema = z.enum(['fresh', 'stale', 'unreachable']);

export const workItemSummarySchema = z.object({
  key: z.string(),
  title: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
  packageId: z.string(),
  sdlcName: z.string(),
  unit: z.string(),
  stateId: z.string(),
  stateName: z.string().nullable(),
  rawState: z.string(),
  attention: attentionSignalSchema.nullable(),
  reconciledAt: z.string(),
  freshness: freshnessSchema,
  disagreements: z.array(providerDisagreementSchema),
  /** 004. Required, not optional — see `WorkItemSummary.terminal`. */
  terminal: z.boolean(),
});

export const gateViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  blocking: z.boolean(),
  awaitsHuman: z.boolean(),
  result: gateResultSchema,
  actionLocation: z.string().nullable(),
});

export const artifactRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  provider: z.string(),
  required: z.boolean(),
});

export const stateViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  ordinal: z.number(),
  progress: z.enum(['completed', 'current', 'blocked', 'not_reached']),
  awaitsHuman: z.boolean(),
  terminal: z.boolean(),
  gates: z.array(gateViewSchema),
  artifacts: z.array(artifactRefSchema),
});

export const workItemDetailSchema = z.object({
  item: workItemSummarySchema,
  states: z.array(stateViewSchema),
  currentStateId: z.string().nullable(),
});

export const providerHealthSchema = z.object({
  providerId: z.string(),
  kind: z.string(),
  status: z.enum(['ok', 'not_configured', 'unauthenticated', 'unreachable', 'rate_limited', 'unsupported']),
  message: z.string(),
  checkedAt: z.string(),
});

export const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  packageId: z.string(),
  packageVersion: z.string(),
  config: z.record(z.string(), z.unknown()),
  // Carries providerStatus, never secrets (ipc-surface.md rule 3).
  providerStatus: z.record(z.string(), providerHealthSchema),
  availability: z.enum(['available', 'path_missing', 'unsupported_package']),
  problem: z.string().nullable(),
});

export const configFieldSchema = z.object({
  key: z.string(),
  title: z.string(),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

/** What the repositories view needs to know about an installed package. */
export const sdlcPackageSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  path: z.string(),
  contractVersion: z.number(),
  /** False when the package carries no usable manifest (FR-045). */
  supported: z.boolean(),
  /** Names what is missing, for an unsupported package. */
  problem: z.string().nullable(),
  problemField: z.string().nullable(),
  problemLine: z.number().nullable(),
  stateCount: z.number(),
  /**
   * 004. How many of this package's states are declared terminal.
   *
   * A count, not a verdict. Zero means the lifecycle never lets work go and its
   * items never leave the active list; equal to `stateCount` means it finishes
   * work the instant it appears. One number answers both, and what to *say*
   * about either is the view's business, not the engine's (research.md §4).
   */
  terminalStateCount: z.number(),
  unit: z.string(),
  repoConfig: z.array(configFieldSchema),
  providerKinds: z.array(z.string()),
});

export const artifactContentSchema = z.object({
  artifactId: z.string(),
  kind: z.string(),
  provider: z.string(),
  locator: z.string(),
  // Inert text. Never HTML for injection (ipc-surface.md rule 6, FR-020).
  content: z.string(),
  reconciledAt: z.string(),
  truncated: z.boolean(),
  byteLength: z.number(),
});

export const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  at: z.string(),
});

// ── Requests (renderer to main) ─────────────────────────────────────────────

export const itemFilterSchema = z
  .object({
    repositoryId: z.string().optional(),
    packageId: z.string().optional(),
    stateId: z.string().optional(),
    /** Matches identifier or title (FR-004). */
    search: z.string().optional(),
    /**
     * 004. Return work the lifecycle considers finished as well as work in
     * flight. Absent means no, so every caller written before this existed keeps
     * the behaviour it had — and the default request stays bounded, which is the
     * point of the feature (research.md §2).
     */
    includeTerminal: z.boolean().optional(),
  })
  .strict();

export const registerRepositoryInputSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
    packageId: z.string().min(1),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const refreshScopeSchema = z
  .object({
    repositoryId: z.string().optional(),
    itemKey: z.string().optional(),
  })
  .strict();

export const itemKeyArgSchema = z.object({ key: z.string().min(1) }).strict();

export const artifactArgSchema = z
  .object({
    key: z.string().min(1),
    stateId: z.string().min(1),
    artifactId: z.string().min(1),
  })
  .strict();

export const conversationArgSchema = z
  .object({ key: z.string().min(1), stateId: z.string().min(1) })
  .strict();

export const askConsoleArgSchema = z
  .object({ key: z.string().min(1), stateId: z.string().min(1), message: z.string().min(1) })
  .strict();

export const updateConfigArgSchema = z
  .object({ id: z.string().min(1), config: z.record(z.string(), z.unknown()) })
  .strict();

export const removeRepositoryArgSchema = z.object({ id: z.string().min(1) }).strict();

export const setCredentialArgSchema = z
  .object({ providerId: z.string().min(1), secret: z.string().min(1) })
  .strict();

// ── Change events ───────────────────────────────────────────────────────────

/**
 * Invalidations, not payloads. Events say *what* changed and the renderer
 * re-reads through the query cache; pushing data would give the renderer a second
 * source of truth alongside its cache (ipc-surface.md §3, Principles VI and XIII).
 */
export const changeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('items'), repositoryId: z.string() }),
  z.object({ type: z.literal('item'), key: z.string() }),
  z.object({ type: z.literal('repositories') }),
  z.object({ type: z.literal('providerHealth'), providerId: z.string(), health: providerHealthSchema }),
]);

// ── Reply schemas, one per channel ──────────────────────────────────────────

export const listPackagesReplySchema = z.array(sdlcPackageSummarySchema);
/**
 * The directories discovery scanned, in the order it scanned them.
 *
 * Absolute filesystem paths, which are already visible to the engineer as
 * `SdlcPackageSummary.path` for every package that *was* found — so this reports
 * where the application looked rather than exposing anything new. No secret has
 * ever travelled on this surface and none starts here (rule 3).
 */
export const packageSearchPathsReplySchema = z.array(z.string());
export const listRepositoriesReplySchema = z.array(repositorySchema);
export const listItemsReplySchema = z.array(workItemSummarySchema);
export const getItemReplySchema = resultSchema(workItemDetailSchema);
export const getArtifactReplySchema = resultSchema(artifactContentSchema);
export const repositoryResultSchema = resultSchema(repositorySchema);
export const messageResultSchema = resultSchema(messageSchema);
export const conversationReplySchema = z.array(messageSchema);
/**
 * The console's assistant, reported the same way every other provider's status is
 * (FR-026, FR-035, Principle I). A health report names the provider and what it
 * needs; it has never carried a credential and must not begin to (rule 3), which
 * is why this reuses `providerHealthSchema` rather than declaring a shape of its
 * own that could drift from it.
 */
export const consoleAvailabilityReplySchema = providerHealthSchema;

// ── Inferred types, shared by both processes ────────────────────────────────

export type SdlcPackageSummary = z.infer<typeof sdlcPackageSummarySchema>;
export type ItemFilter = z.infer<typeof itemFilterSchema>;
export type RegisterRepositoryInput = z.infer<typeof registerRepositoryInputSchema>;
export type RefreshScope = z.infer<typeof refreshScopeSchema>;
export type ChangeEvent = z.infer<typeof changeEventSchema>;
export type ConfigFieldPayload = z.infer<typeof configFieldSchema>;
