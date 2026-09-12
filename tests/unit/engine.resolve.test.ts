/**
 * T036 — state resolution and gate evaluation.
 *
 * The claim these tests defend is SC-005: "no gate lacking a result is ever
 * displayed as passed". That is a claim about a default, and defaults are exactly
 * what erodes silently, so it is asserted from several directions below.
 */

import { describe, expect, it, vi } from 'vitest';

import { evaluateCondition, evaluateStateGates, materialiseGateResult } from '@core/engine/evaluateGate';
import { isDeclaredState, resolveState } from '@core/engine/resolveState';
import { UNMAPPED, isUnmapped } from '@core/model/observed';
import { fail, ok } from '@core/model/result';
import type { GateDecl } from '@core/model/declared';

import { gate, lifecycle, sixStageLifecycle } from '../support/lifecycle';

describe('resolveState', () => {
  const definition = lifecycle({
    owner: 'ledger',
    states: [
      { id: 'intake', maps: { ledger: ['Received', 'Logged'] } },
      { id: 'appraisal', maps: { ledger: ['Being valued'] } },
      { id: 'settled', terminal: true, maps: { ledger: ['Closed'] } },
    ],
  });

  it('maps a declared raw value to its state', () => {
    expect(resolveState(definition, 'ledger', 'Being valued').stateId).toBe('appraisal');
  });

  it('maps every value a state declares, not only the first', () => {
    expect(resolveState(definition, 'ledger', 'Received').stateId).toBe('intake');
    expect(resolveState(definition, 'ledger', 'Logged').stateId).toBe('intake');
  });

  it('yields UNMAPPED for a value no state declares (FR-005)', () => {
    const resolution = resolveState(definition, 'ledger', 'Impounded');
    expect(isUnmapped(resolution.stateId)).toBe(true);
  });

  it('retains the raw value when unmapped, so the row can show what was actually recorded', () => {
    expect(resolveState(definition, 'ledger', 'Impounded').rawState).toBe('Impounded');
  });

  it('retains the raw value when mapped too', () => {
    expect(resolveState(definition, 'ledger', 'Logged').rawState).toBe('Logged');
  });

  it('never coerces to a nearby state — a near miss is unmapped, not the closest match', () => {
    // "Being valued " differs by one trailing space from a declared value.
    expect(isUnmapped(resolveState(definition, 'ledger', 'Being valued ').stateId)).toBe(true);
    expect(isUnmapped(resolveState(definition, 'ledger', 'being valued').stateId)).toBe(true);
  });

  it('resolves within the owning provider vocabulary only', () => {
    const composed = lifecycle({
      owner: 'ledger',
      providers: [
        { id: 'ledger', kind: 'memo', settings: {} },
        { id: 'depot', kind: 'memo', settings: {} },
      ],
      states: [
        { id: 'intake', maps: { ledger: ['Received'], depot: ['Held'] } },
        { id: 'appraisal', maps: { ledger: ['Held'], depot: ['Received'] } },
      ],
    });
    // The same raw value means different states in different vocabularies, which
    // is why the owner has to be passed in rather than inferred.
    expect(resolveState(composed, 'ledger', 'Held').stateId).toBe('appraisal');
    expect(resolveState(composed, 'depot', 'Held').stateId).toBe('intake');
  });

  it('treats an absent or empty raw value as unmapped rather than as the first state', () => {
    expect(isUnmapped(resolveState(definition, 'ledger', undefined).stateId)).toBe(true);
    expect(isUnmapped(resolveState(definition, 'ledger', null).stateId)).toBe(true);
    expect(isUnmapped(resolveState(definition, 'ledger', '').stateId)).toBe(true);
  });

  it('yields UNMAPPED when the owning provider declares no maps at all', () => {
    expect(isUnmapped(resolveState(definition, 'nobody', 'Received').stateId)).toBe(true);
  });

  it('UNMAPPED is neither null nor any declared state id (T014)', () => {
    expect(UNMAPPED).not.toBeNull();
    for (const state of definition.states) {
      expect(state.id).not.toBe(UNMAPPED);
    }
  });
});

describe('isDeclaredState — surviving a package upgrade (FR-046)', () => {
  const before = lifecycle({ states: [{ id: 'intake' }, { id: 'appraisal' }, { id: 'settled' }] });
  const after = lifecycle({ states: [{ id: 'intake' }, { id: 'settled' }] });

  it('recognises a state the current definition still declares', () => {
    expect(isDeclaredState(after, 'intake')).toBe(true);
  });

  it('reports a state removed by an upgrade as no longer declared', () => {
    expect(isDeclaredState(before, 'appraisal')).toBe(true);
    expect(isDeclaredState(after, 'appraisal')).toBe(false);
  });

  it('never treats the unmapped sentinel as declared', () => {
    expect(isDeclaredState(after, UNMAPPED)).toBe(false);
  });
});

describe('evaluateCondition', () => {
  it('equals compares by value, including structurally', () => {
    expect(evaluateCondition({ equals: 'yes' }, 'yes')).toBe(true);
    expect(evaluateCondition({ equals: 'yes' }, 'no')).toBe(false);
    expect(evaluateCondition({ equals: true }, true)).toBe(true);
    expect(evaluateCondition({ equals: { a: 1 } }, { a: 1 })).toBe(true);
  });

  it('notEquals is the negation', () => {
    expect(evaluateCondition({ notEquals: 'yes' }, 'no')).toBe(true);
    expect(evaluateCondition({ notEquals: 'yes' }, 'yes')).toBe(false);
  });

  it('oneOf accepts any listed value', () => {
    expect(evaluateCondition({ oneOf: ['a', 'b'] }, 'b')).toBe(true);
    expect(evaluateCondition({ oneOf: ['a', 'b'] }, 'c')).toBe(false);
  });

  it('matches applies a regular expression to a string', () => {
    expect(evaluateCondition({ matches: '^ok-' }, 'ok-1')).toBe(true);
    expect(evaluateCondition({ matches: '^ok-' }, 'no')).toBe(false);
    expect(evaluateCondition({ matches: '^ok-' }, 42)).toBe(false);
  });

  it('a malformed pattern cannot match, and cannot throw across the engine', () => {
    expect(() => evaluateCondition({ matches: '([' }, 'anything')).not.toThrow();
    expect(evaluateCondition({ matches: '([' }, 'anything')).toBe(false);
  });

  it('present and absent distinguish null and undefined from a falsy value', () => {
    expect(evaluateCondition({ present: true }, false)).toBe(true);
    expect(evaluateCondition({ present: true }, 0)).toBe(true);
    expect(evaluateCondition({ present: true }, null)).toBe(false);
    expect(evaluateCondition({ absent: true }, undefined)).toBe(true);
    expect(evaluateCondition({ absent: true }, '')).toBe(false);
  });

  it('an undeclared condition never passes', () => {
    expect(evaluateCondition(undefined, 'anything')).toBe(false);
  });
});

describe('materialiseGateResult — absence is never success (FR-014, SC-005)', () => {
  const decl: GateDecl = gate({ id: 'weighed', kind: 'check', provider: 'ledger' });

  it('materialises a missing read as not_evaluated, never omitting it', () => {
    const result = materialiseGateResult(decl, undefined);
    expect(result.status).toBe('not_evaluated');
    expect(result.gateId).toBe('weighed');
  });

  it('materialises a failed read as not_evaluated carrying the reason, not as failed', () => {
    const result = materialiseGateResult(decl, fail('unreachable', 'the ledger did not answer'));
    // A gate we could not read is not a gate that failed: the distinction is the
    // difference between "the check says no" and "we do not know".
    expect(result.status).toBe('not_evaluated');
    expect(result.detail).toBe('the ledger did not answer');
  });

  it('never defaults to passed under any input', () => {
    const inputs = [
      undefined,
      fail('unreachable', 'x'),
      fail('unauthenticated', 'x'),
      fail('rate_limited', 'x'),
      fail('not_found', 'x'),
      fail('invalid_response', 'x'),
      fail('not_configured', 'x'),
    ];
    for (const input of inputs) {
      expect(materialiseGateResult(decl, input).status).not.toBe('passed');
    }
  });

  it('passes a recorded result through unchanged', () => {
    const recorded = materialiseGateResult(
      decl,
      ok({ gateId: 'weighed', status: 'passed' as const, evaluatedAt: '2026-09-11T00:00:00.000Z', evidence: null, detail: 'within tolerance' }),
    );
    expect(recorded.status).toBe('passed');
    expect(recorded.detail).toBe('within tolerance');
  });

  it('enforces the invariant that evaluatedAt is null exactly when not_evaluated', () => {
    const inconsistent = materialiseGateResult(
      decl,
      ok({ gateId: 'weighed', status: 'not_evaluated' as const, evaluatedAt: '2026-09-11T00:00:00.000Z', evidence: null, detail: null }),
    );
    expect(inconsistent.evaluatedAt).toBeNull();
  });

  it('stamps the declaration id, so a provider cannot mislabel a result', () => {
    const mislabelled = materialiseGateResult(
      decl,
      ok({ gateId: 'something-else', status: 'passed' as const, evaluatedAt: '2026-09-11T00:00:00.000Z', evidence: null, detail: null }),
    );
    expect(mislabelled.gateId).toBe('weighed');
  });
});

describe('evaluateStateGates — one uniform path for all four kinds', () => {
  const definition = sixStageLifecycle();
  const dispatch = definition.states[3];

  it('produces a result for every declared gate, including ones nothing was read for', async () => {
    const results = await evaluateStateGates(dispatch!, async () => fail('not_found', 'nothing recorded'));
    expect(results).toHaveLength(dispatch!.gates.length);
    expect(results.every((result) => result.status === 'not_evaluated')).toBe(true);
  });

  it('preserves declaration order, because the tab renders them in it', async () => {
    const results = await evaluateStateGates(dispatch!, async (decl) =>
      ok({ gateId: decl.id, status: 'passed' as const, evaluatedAt: '2026-09-11T00:00:00.000Z', evidence: null, detail: null }),
    );
    expect(results.map((result) => result.gateId)).toEqual(dispatch!.gates.map((declared) => declared.id));
  });

  it('does not branch on kind — every kind reaches the reader identically', async () => {
    const definitionWithAllKinds = lifecycle({
      states: [
        {
          id: 'assorted',
          gates: [
            { id: 'a', kind: 'manual', awaitsHuman: true },
            { id: 'b', kind: 'artifact', passesWhen: { present: true } },
            { id: 'c', kind: 'check', provider: 'ledger' },
            { id: 'd', kind: 'field', provider: 'ledger', passesWhen: { equals: 1 } },
          ],
        },
      ],
    });
    const seen: string[] = [];
    await evaluateStateGates(definitionWithAllKinds.states[0]!, async (decl) => {
      seen.push(decl.kind);
      return fail('not_found', 'nothing recorded');
    });
    expect(seen).toEqual(['manual', 'artifact', 'check', 'field']);
  });

  it('absorbs a provider that throws, rather than letting one adapter take down the item', async () => {
    const reader = vi.fn(async () => {
      throw new Error('adapter exploded');
    });
    const results = await evaluateStateGates(dispatch!, reader);
    expect(results.every((result) => result.status === 'not_evaluated')).toBe(true);
    expect(results[0]?.detail).toContain('adapter exploded');
  });

  it('returns an empty list for a state declaring no gates, not a fabricated pass', async () => {
    const results = await evaluateStateGates(definition.states[0]!, async () =>
      ok({ gateId: 'x', status: 'passed' as const, evaluatedAt: '2026-09-11T00:00:00.000Z', evidence: null, detail: null }),
    );
    expect(results).toEqual([]);
  });
});
