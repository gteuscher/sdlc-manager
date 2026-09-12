/**
 * T035 — how far an item has travelled, and where it stalled (FR-013, SC-002).
 *
 * Derived from two things only: the item's ordinal position in the ordered state
 * list, and the gate results recorded against it. Nothing here knows the name of
 * any state.
 */

import type { SdlcDefinition, State } from '../model/declared.js';
import { isUnmapped, type GateResult, type ResolvedStateId, type StateProgress } from '../model/observed.js';
import { gateResultFor } from './evaluateGate.js';

/** A blocking gate that failed is what "stalled" means. */
export function blockingFailure(state: State, results: readonly GateResult[]): GateResult | undefined {
  for (const gate of state.gates) {
    if (!gate.blocking) continue;
    const result = gateResultFor(results, gate.id);
    if (result?.status === 'failed') return result;
  }
  return undefined;
}

export function stateProgress(
  definition: SdlcDefinition,
  currentStateId: ResolvedStateId,
  state: State,
  results: readonly GateResult[],
): StateProgress {
  // An item whose recorded state resolves to nothing has no position in the
  // lifecycle, so no state can honestly be called completed or current. The raw
  // value is shown instead (FR-005, FR-046).
  if (isUnmapped(currentStateId)) return 'not_reached';

  const current = definition.states.find((candidate) => candidate.id === currentStateId);
  if (current === undefined) return 'not_reached';

  if (state.ordinal < current.ordinal) return 'completed';
  if (state.ordinal > current.ordinal) return 'not_reached';

  return blockingFailure(state, results) === undefined ? 'current' : 'blocked';
}

/** Every state's progress, in lifecycle order. */
export function deriveProgress(
  definition: SdlcDefinition,
  currentStateId: ResolvedStateId,
  results: readonly GateResult[],
): Map<string, StateProgress> {
  const progress = new Map<string, StateProgress>();
  for (const state of definition.states) {
    progress.set(state.id, stateProgress(definition, currentStateId, state, results));
  }
  return progress;
}
