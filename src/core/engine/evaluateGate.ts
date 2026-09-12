/**
 * T034 — gate evaluation, all four kinds through one uniform path.
 *
 * Nothing below branches on `kind`. That is the point: validation, verification,
 * and integration-backed gates differ only by which provider reads them, so the
 * engine treats them interchangeably (Principle II, sdlc-manifest.md §2 rule 3).
 *
 * The invariant this module exists to protect: a gate with no recorded result is
 * materialised as `not_evaluated`, never omitted and never defaulted to `passed`.
 * Omission would let a consumer read absence as success, which FR-014 forbids and
 * SC-005 measures.
 */

import type { Condition, GateDecl, State } from '../model/declared.js';
import type { GateResult } from '../model/observed.js';
import type { Result } from '../model/result.js';

/** Reads one gate from whichever provider the declaration names. */
export type GateReader = (decl: GateDecl) => Promise<Result<GateResult>>;

/**
 * Applies a `passes_when` condition to an observed value.
 *
 * Lives in the engine rather than in each provider because the condition is
 * declared in the manifest, and a provider that interprets the manifest has
 * absorbed lifecycle knowledge. Providers call this; they do not reimplement it.
 */
export function evaluateCondition(condition: Condition | undefined, value: unknown): boolean {
  if (condition === undefined) return false;

  if ('equals' in condition) return deepEqual(value, condition.equals);
  if ('notEquals' in condition) return !deepEqual(value, condition.notEquals);
  if ('oneOf' in condition) return condition.oneOf.some((candidate) => deepEqual(value, candidate));
  if ('matches' in condition) {
    if (typeof value !== 'string') return false;
    try {
      return new RegExp(condition.matches).test(value);
    } catch {
      // A malformed pattern must not throw across the engine; it simply cannot match.
      return false;
    }
  }
  if ('present' in condition) return value !== undefined && value !== null;
  if ('absent' in condition) return value === undefined || value === null;
  return false;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (typeof left !== 'object') return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Normalises whatever a provider returned into the three-value contract.
 *
 * A failed read is `not_evaluated` carrying the reason, not a failure that
 * propagates: one unreadable gate must not remove the rest of the state from view
 * (Principle III, FR-019).
 */
export function materialiseGateResult(decl: GateDecl, read: Result<GateResult> | undefined): GateResult {
  if (read === undefined) {
    return {
      gateId: decl.id,
      status: 'not_evaluated',
      evaluatedAt: null,
      evidence: null,
      detail: 'No result has been recorded for this gate.',
    };
  }

  if (!read.ok) {
    return {
      gateId: decl.id,
      status: 'not_evaluated',
      evaluatedAt: null,
      evidence: null,
      detail: read.message,
    };
  }

  const result = read.value;
  // Enforce the invariant regardless of what the provider returned:
  // `evaluatedAt` is null exactly when the status is not_evaluated.
  if (result.status === 'not_evaluated' && result.evaluatedAt !== null) {
    return { ...result, gateId: decl.id, evaluatedAt: null };
  }
  return { ...result, gateId: decl.id };
}

/**
 * Evaluates every gate a state declares, in declaration order.
 *
 * Every declared gate produces a result, including the ones nothing could be read
 * for — FR-014 requires the state to show *every* gate it declares, not only the
 * ones that happened to resolve.
 */
export async function evaluateStateGates(state: State, read: GateReader): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const gate of state.gates) {
    let read_: Result<GateResult> | undefined;
    try {
      read_ = await read(gate);
    } catch (error) {
      // A provider that throws has broken rule 1; absorb it rather than letting
      // one misbehaving adapter take down the item.
      read_ = {
        ok: false,
        reason: 'invalid_response',
        message: `Reading this gate failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    results.push(materialiseGateResult(gate, read_));
  }
  return results;
}

/** Every gate the whole definition declares, evaluated once per item. */
export async function evaluateAllGates(
  states: readonly State[],
  read: GateReader,
): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const state of states) {
    results.push(...(await evaluateStateGates(state, read)));
  }
  return results;
}

export function gateResultFor(results: readonly GateResult[], gateId: string): GateResult | undefined {
  return results.find((result) => result.gateId === gateId);
}
