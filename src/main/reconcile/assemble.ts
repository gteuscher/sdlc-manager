/**
 * Raw provider output to a `WorkItem`.
 *
 * This is where the declared family and the observed family meet: the manifest
 * says which provider owns the state, what the raw values mean, and which gates
 * the occupied state declares; the providers say what they found. Nothing here
 * names a state, a gate, or a provider — every decision is read out of the
 * definition (Principle II).
 *
 * ## Freshness (FR-037, SC-007)
 *
 * Three values, and the distinction between them is the requirement:
 *
 *   `fresh`       every provider this item depends on answered this cycle.
 *   `stale`       a provider failed and the item is being served from the last
 *                 reconciled data. `reconciledAt` deliberately keeps its **old**
 *                 value — it records when the item was last reconciled with its
 *                 system of record (FR-002), and re-stamping it because we
 *                 re-read our own cache would be a lie the interface then shows.
 *   `unreachable` a provider failed and there is nothing cached to serve.
 *
 * The property SC-007 measures falls out of doing this per item rather than per
 * repository: an item whose providers all answered stays `fresh` and correct
 * while an item depending on the failing provider is marked stale. **One failing
 * provider never removes another provider's items.**
 *
 * ## Gates
 *
 * Every gate the state declares produces a result, including the ones nothing
 * could be read for — `evaluateStateGates` materialises an unreadable gate as
 * `not_evaluated`, never omitting it and never defaulting it to `passed`
 * (FR-014). A gate whose provider is absent is `not_evaluated` naming the absence,
 * for the same reason: absence is never success.
 */

import { deriveAttention } from '@core/engine/attention.js';
import { evaluateAllGates, evaluateStateGates, type GateReader } from '@core/engine/evaluateGate.js';
import { resolveState } from '@core/engine/resolveState.js';
import { findState, type GateDecl, type ProviderId, type SdlcDefinition } from '@core/model/declared.js';
import {
  isUnmapped,
  type Freshness,
  type GateResult,
  type ItemKey,
  type ProviderDisagreement,
  type ResolvedStateId,
  type WorkItem,
} from '@core/model/observed.js';
import { fail } from '@core/model/result.js';
import { nowIso, type RepoContext } from '@providers/contract.js';

import {
  mergeContributions,
  type DiscoveredItem,
  type ProviderFailure,
  type ProviderLookup,
} from './discover.js';

export interface AssembleInput {
  readonly ctx: RepoContext;
  readonly lookup: ProviderLookup;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly discovered: DiscoveredItem;
  /** Discovery failures from this cycle, used to decide freshness. */
  readonly failures: readonly ProviderFailure[];
  /** The last reconciled copy, if there is one. Serving it is what `stale` means. */
  readonly cached?: WorkItem | undefined;
  readonly now?: () => Date;
  /**
   * Evaluate every state's gates rather than only the occupied one.
   *
   * The list view needs the occupied state's gates, because that is what the
   * attention signal is derived from. The detail view needs all of them, because
   * FR-014 requires every state to show every gate it declares. The list pays for
   * what it uses.
   */
  readonly allGates?: boolean;
}

/**
 * Builds one `WorkItem`. Never rejects: every provider failure becomes a value.
 */
export async function assembleWorkItem(input: AssembleInput): Promise<WorkItem> {
  const { ctx, discovered, cached } = input;
  const definition = ctx.definition;
  const merged = mergeContributions(definition, discovered);
  const ownerId = definition.ownership.state;

  const state = await readOwnedState(input, merged.rawState.value, merged.rawState.winner, ownerId);

  const disagreements: ProviderDisagreement[] = merged.disagreements.filter(
    (entry) => entry.field !== 'state',
  );
  const stateDisagreement = state.disagreement ?? findStateDisagreement(merged.disagreements);
  if (stateDisagreement !== null) disagreements.push(stateDisagreement);

  const resolution =
    state.source === 'cached' && cached !== undefined
      ? { stateId: cached.stateId, rawState: cached.rawState }
      : resolveState(definition, ownerId, state.raw);

  const gateResults = await readGates(input, resolution.stateId, state.source === 'cached' ? cached : undefined);

  const freshness = freshnessFor(state.source, cached);
  const reconciledAt =
    // Cached data keeps the time it was actually reconciled (FR-002).
    freshness === 'stale' && cached !== undefined ? cached.reconciledAt : nowIso(input.now);

  return {
    key: discovered.key,
    title: merged.title.value ?? cached?.title ?? discovered.key,
    repositoryId: ctx.repositoryId,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    unit: definition.items.unit,
    stateId: resolution.stateId,
    // Always retained, mapped or not (FR-005).
    rawState: resolution.rawState,
    gateResults,
    // Derived, never stored by a provider, so it survives a restart (FR-007).
    attention: deriveAttention(definition, resolution.stateId, gateResults),
    reconciledAt,
    freshness,
    sources: merged.sources,
    disagreements,
    fields: merged.fields,
  };
}

/**
 * Re-marks a cached item when its provider could not be reached this cycle.
 *
 * Used for an item that was listed last time and that a failing provider would
 * have supplied again: it stays visible, marked stale, keeping the time it was
 * genuinely last reconciled (FR-037, spec §Edge Cases).
 */
export function serveFromCache(cached: WorkItem): WorkItem {
  if (cached.freshness === 'stale') return cached;
  return { ...cached, freshness: 'stale' };
}

/** Which provider supplies a gate's result, read entirely from the declaration. */
export function gateProviderId(
  definition: SdlcDefinition,
  decl: GateDecl,
): ProviderId | undefined {
  return (
    decl.provider ??
    decl.locator?.provider ??
    decl.evidence?.provider ??
    // A gate that names nothing is read by whichever provider owns this
    // lifecycle's artifacts; that is where evidence lives when nothing says
    // otherwise.
    definition.ownership.artifacts
  );
}

/**
 * Routes a gate declaration to the provider that records its result.
 *
 * Exported because the detail handler evaluates gates for every state, and must
 * route them exactly as the list does — two routing rules would let a gate read
 * one way in the list and another in the detail view.
 */
export function createGateReader(
  ctx: RepoContext,
  lookup: ProviderLookup,
  key: ItemKey,
): GateReader {
  return async (decl: GateDecl) => {
    const providerId = gateProviderId(ctx.definition, decl);
    if (providerId === undefined) {
      return fail(
        'invalid_input',
        `The '${decl.name}' gate names no provider and this lifecycle declares no artifact owner, ` +
          'so there is nowhere to read its result from.',
        { field: `gates.${decl.id}.provider` },
      );
    }
    const provider = lookup(providerId);
    if (provider === undefined) {
      return fail(
        'unavailable',
        `The '${decl.name}' gate reads from the '${providerId}' provider, which this build has no ` +
          'adapter for. Nothing is recorded for it, and absence is not a pass.',
        { field: `gates.${decl.id}.provider` },
      );
    }
    return provider.readGate(ctx, decl, key);
  };
}

// ── Internals ────────────────────────────────────────────────────────────────

type StateSource = 'discovered' | 'read' | 'cached' | 'none';

interface OwnedState {
  readonly raw: string;
  readonly source: StateSource;
  readonly disagreement: ProviderDisagreement | null;
}

/**
 * The raw status value, from the provider the manifest designates (FR-003).
 *
 * Discovery already asked every provider for what it knows, so when the owner
 * supplied a value there it is used as-is rather than read a second time. The
 * extra `readState` call happens only when the owner contributed nothing to
 * discovery — which is exactly the composed case, where a tracker owns state and
 * the filesystem found the item.
 */
async function readOwnedState(
  input: AssembleInput,
  discoveredValue: string | undefined,
  discoveredWinner: ProviderId | undefined,
  ownerId: ProviderId,
): Promise<OwnedState> {
  if (discoveredValue !== undefined && discoveredWinner === ownerId) {
    return { raw: discoveredValue, source: 'discovered', disagreement: null };
  }

  const owner = input.lookup(ownerId);
  if (owner !== undefined) {
    let read: Awaited<ReturnType<typeof owner.readState>>;
    try {
      read = await owner.readState(input.ctx, input.discovered.key);
    } catch (error) {
      read = fail(
        'invalid_response',
        `The '${ownerId}' provider failed unexpectedly while reading this item's status: ${describeError(error)}.`,
      );
    }
    if (read.ok) {
      // The owner has spoken. Another provider's differing value is recorded
      // rather than dropped (spec §Edge Cases).
      const disagreement =
        discoveredValue !== undefined &&
        discoveredValue !== read.value.value &&
        discoveredWinner !== undefined
          ? {
              field: 'state',
              winner: ownerId,
              winningValue: read.value.value,
              others: [{ provider: discoveredWinner, value: discoveredValue }],
            }
          : null;
      return { raw: read.value.value, source: 'read', disagreement };
    }
  }

  // The owner could not be read. Another provider's value is better than nothing
  // and is current, so it is used and the disagreement (if any) already recorded
  // by the merge stands.
  if (discoveredValue !== undefined) {
    return { raw: discoveredValue, source: 'discovered', disagreement: null };
  }

  if (input.cached !== undefined) {
    return { raw: input.cached.rawState, source: 'cached', disagreement: null };
  }

  return { raw: '', source: 'none', disagreement: null };
}

async function readGates(
  input: AssembleInput,
  stateId: ResolvedStateId,
  cached: WorkItem | undefined,
): Promise<GateResult[]> {
  // Serving cached data: re-reading gates from a provider that just failed would
  // only produce a wall of `not_evaluated` where a real recorded result is known.
  if (cached !== undefined) return [...cached.gateResults];

  const definition = input.ctx.definition;
  const read = createGateReader(input.ctx, input.lookup, input.discovered.key);

  if (input.allGates === true) {
    return evaluateAllGates(definition.states, read);
  }

  if (isUnmapped(stateId)) {
    // No state is occupied, so no state's gates apply. The raw value is what the
    // interface shows instead (FR-005).
    return [];
  }

  const state = findState(definition, stateId);
  if (state === undefined) return [];
  return evaluateStateGates(state, read);
}

function freshnessFor(source: StateSource, cached: WorkItem | undefined): Freshness {
  if (source === 'discovered' || source === 'read') return 'fresh';
  if (source === 'cached' && cached !== undefined) return 'stale';
  // Nothing answered and nothing was cached: the item exists (discovery found it)
  // but its status could not be reached at all.
  return 'unreachable';
}

function findStateDisagreement(
  disagreements: readonly ProviderDisagreement[],
): ProviderDisagreement | null {
  return disagreements.find((entry) => entry.field === 'state') ?? null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
