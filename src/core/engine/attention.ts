/**
 * T061 — deriving the attention signal (FR-006, FR-007).
 *
 * A pure function of `(State.awaitsHuman, GateDecl.awaitsHuman, GateResult.status)`.
 *
 * Because it is derived rather than stored, the signal survives a restart and a
 * cache wipe: nothing needs to remember that an item was blocked, because the
 * facts that make it blocked are read back from the system of record every time
 * (FR-007, spec §Edge Cases — "the attention signal must survive a restart").
 *
 * Attention is declared, not inferred. The lifecycle marks which states and gates
 * await a human; this function never guesses from heuristics.
 */

import type { SdlcDefinition } from '../model/declared.js';
import { isUnmapped, type AttentionSignal, type GateResult, type ResolvedStateId } from '../model/observed.js';
import { gateResultFor } from './evaluateGate.js';

export function deriveAttention(
  definition: SdlcDefinition,
  currentStateId: ResolvedStateId,
  results: readonly GateResult[],
): AttentionSignal | null {
  if (isUnmapped(currentStateId)) return null;

  const state = definition.states.find((candidate) => candidate.id === currentStateId);
  if (state === undefined) return null;

  // A terminal state is the end of the lifecycle; nothing is owed there.
  if (state.terminal) return null;

  // A failed blocking gate is the most specific thing that can be wrong, so it
  // wins over the state-level signal: it names what failed rather than only that
  // something is waiting.
  for (const gate of state.gates) {
    const result = gateResultFor(results, gate.id);
    if (result?.status !== 'failed') continue;
    if (!gate.blocking && !gate.awaitsHuman) continue;
    return {
      kind: 'gate_failed',
      reason: `${gate.name} failed${result.detail ? `: ${result.detail}` : ''}`,
      stateId: state.id,
      gateId: gate.id,
    };
  }

  // A gate that names the engineer specifically, with nothing recorded yet.
  for (const gate of state.gates) {
    if (!gate.awaitsHuman) continue;
    const result = gateResultFor(results, gate.id);
    if (result === undefined || result.status === 'not_evaluated') {
      return {
        kind: 'input_needed',
        reason: `${gate.name} is waiting on a decision in ${state.name}`,
        stateId: state.id,
        gateId: gate.id,
      };
    }
  }

  // The state itself is declared as one that rests until a human acts.
  if (state.awaitsHuman) {
    return {
      kind: 'input_needed',
      reason: `${state.name} is waiting on you`,
      stateId: state.id,
    };
  }

  return null;
}

/** FR-009: how many items currently need the engineer. */
export function countAttention(signals: readonly (AttentionSignal | null)[]): number {
  return signals.reduce<number>((total, signal) => (signal === null ? total : total + 1), 0);
}

/**
 * FR-008: items carrying attention markers come first.
 *
 * Stable within each group, so the caller's ordering — most recently reconciled,
 * say — survives underneath.
 */
export function attentionFirst<T>(items: readonly T[], signalOf: (item: T) => AttentionSignal | null): T[] {
  const needing: T[] = [];
  const progressing: T[] = [];
  for (const item of items) {
    (signalOf(item) === null ? progressing : needing).push(item);
  }
  return [...needing, ...progressing];
}
