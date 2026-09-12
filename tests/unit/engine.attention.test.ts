/**
 * T056 — attention derivation (FR-006, FR-007).
 *
 * Two properties are under test. First, that `input_needed` and `gate_failed` are
 * genuinely distinguished rather than collapsed into one "needs you" flag — the
 * spec requires the engineer to tell an approval apart from a failure without
 * opening the item. Second, that the derivation is *pure*: given the same
 * definition and the same recorded results it returns the same signal, which is
 * what makes the marker survive a restart and a cache wipe.
 */

import { describe, expect, it } from 'vitest';

import { attentionFirst, countAttention, deriveAttention } from '@core/engine/attention';
import { UNMAPPED } from '@core/model/observed';

import { lifecycle, result, sixStageLifecycle } from '../support/lifecycle';

const definition = sixStageLifecycle();

describe('deriveAttention', () => {
  it('reports input_needed for a state declared as awaiting a human', () => {
    const signal = deriveAttention(definition, 'consent', [result('signed-off', 'not_evaluated')]);
    expect(signal?.kind).toBe('input_needed');
  });

  it('reports gate_failed for a blocking gate that failed', () => {
    const signal = deriveAttention(definition, 'dispatch', [result('weighed', 'failed', 'over the limit')]);
    expect(signal?.kind).toBe('gate_failed');
  });

  it('distinguishes the two kinds, which is the whole point of FR-006', () => {
    const waiting = deriveAttention(definition, 'consent', [result('signed-off', 'not_evaluated')]);
    const failed = deriveAttention(definition, 'dispatch', [result('weighed', 'failed')]);
    expect(waiting?.kind).not.toBe(failed?.kind);
  });

  it('names what is waiting, so the reason is actionable (Principle V)', () => {
    const signal = deriveAttention(definition, 'dispatch', [result('weighed', 'failed', 'over the limit')]);
    expect(signal?.reason).toContain('Weight verified');
    expect(signal?.reason).toContain('over the limit');
    expect(signal?.gateId).toBe('weighed');
    expect(signal?.stateId).toBe('dispatch');
  });

  it('prefers the failed gate over the state-level signal, because it names what is wrong', () => {
    const waitingStateWithFailedGate = lifecycle({
      states: [
        {
          id: 'consent',
          awaitsHuman: true,
          gates: [{ id: 'signed-off', name: 'Owner signed off', kind: 'manual', awaitsHuman: true }],
        },
      ],
    });
    const signal = deriveAttention(waitingStateWithFailedGate, 'consent', [result('signed-off', 'failed', 'refused')]);
    expect(signal?.kind).toBe('gate_failed');
  });

  it('reports input_needed for an unevaluated gate that awaits a human', () => {
    const signal = deriveAttention(definition, 'consent', [result('signed-off', 'not_evaluated')]);
    expect(signal?.gateId).toBe('signed-off');
  });

  it('reports input_needed when the awaiting gate has no recorded result at all', () => {
    // Absence and an explicit not_evaluated must behave identically here: a gate
    // nobody has looked at is still a gate waiting on someone.
    const signal = deriveAttention(definition, 'consent', []);
    expect(signal?.kind).toBe('input_needed');
  });

  it('returns null for a state progressing normally', () => {
    expect(deriveAttention(definition, 'intake', [])).toBeNull();
  });

  it('returns null once a gate that awaited a human has passed, in a state that does not itself wait', () => {
    const gateOnlyWait = lifecycle({
      states: [
        { id: 'dispatch', gates: [{ id: 'signed-off', name: 'Owner signed off', kind: 'manual', awaitsHuman: true }] },
      ],
    });
    expect(deriveAttention(gateOnlyWait, 'dispatch', [result('signed-off', 'passed')])).toBeNull();
  });

  it('keeps signalling while an item rests in a state declared as awaiting a human, even after its gate passes', () => {
    // The contract is unconditional about this: `awaits_human: true` "raises an
    // 'input needed' signal for items resting here". The decision having been
    // recorded does not move the item; something still has to.
    expect(deriveAttention(definition, 'consent', [result('signed-off', 'passed')])?.kind).toBe('input_needed');
  });

  it('returns null for a terminal state, where nothing is owed', () => {
    expect(deriveAttention(definition, 'settled', [])).toBeNull();
  });

  it('returns null for an unmapped item, rather than inventing a signal for a state it cannot find', () => {
    expect(deriveAttention(definition, UNMAPPED, [])).toBeNull();
  });

  it('returns null for a state id the definition no longer declares (FR-046)', () => {
    expect(deriveAttention(definition, 'a-state-removed-by-an-upgrade', [])).toBeNull();
  });

  it('ignores a failed non-blocking gate that does not await a human', () => {
    // `labelled` is declared blocking: false and awaitsHuman: false.
    expect(deriveAttention(definition, 'dispatch', [result('labelled', 'failed')])).toBeNull();
  });

  it('is pure: the same inputs give the same signal, so it survives a restart (FR-007)', () => {
    const results = [result('weighed', 'failed', 'over the limit')];
    const first = deriveAttention(definition, 'dispatch', results);
    const second = deriveAttention(definition, 'dispatch', results);
    expect(second).toEqual(first);
  });

  it('is derived, not remembered: a wiped cache reproduces it from the definition alone', () => {
    // Nothing is passed but the definition and the recorded results — there is no
    // session, no store, and nowhere for a stale marker to hide.
    const rebuilt = deriveAttention(sixStageLifecycle(), 'consent', [result('signed-off', 'not_evaluated')]);
    expect(rebuilt).toEqual(deriveAttention(definition, 'consent', [result('signed-off', 'not_evaluated')]));
  });

  it('never mutates the results it is given', () => {
    const results = [result('weighed', 'failed')];
    const snapshot = structuredClone(results);
    deriveAttention(definition, 'dispatch', results);
    expect(results).toEqual(snapshot);
  });
});

describe('countAttention (FR-009)', () => {
  it('counts only the items carrying a signal', () => {
    expect(countAttention([null, { kind: 'input_needed', reason: 'x' }, null, { kind: 'gate_failed', reason: 'y' }])).toBe(2);
  });

  it('is zero when nothing needs the engineer', () => {
    expect(countAttention([null, null])).toBe(0);
    expect(countAttention([])).toBe(0);
  });
});

describe('attentionFirst (FR-008)', () => {
  const rows = [
    { id: 'a', signal: null },
    { id: 'b', signal: { kind: 'gate_failed' as const, reason: 'y' } },
    { id: 'c', signal: null },
    { id: 'd', signal: { kind: 'input_needed' as const, reason: 'x' } },
  ];

  it('orders items needing attention ahead of items progressing normally', () => {
    expect(attentionFirst(rows, (row) => row.signal).map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('is stable within each group, so the caller ordering survives underneath', () => {
    const ordered = attentionFirst(rows, (row) => row.signal);
    expect(ordered.slice(0, 2).map((row) => row.id)).toEqual(['b', 'd']);
    expect(ordered.slice(2).map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('leaves a list needing no attention in its original order', () => {
    const calm = [{ id: 'a', signal: null }, { id: 'b', signal: null }];
    expect(attentionFirst(calm, (row) => row.signal).map((row) => row.id)).toEqual(['a', 'b']);
  });
});
