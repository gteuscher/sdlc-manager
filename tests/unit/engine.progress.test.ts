/**
 * T073 — progress derivation across completed, current, blocked, and not reached
 * (FR-013, SC-002).
 *
 * The lifecycle under test is invented by the tests and named nothing like the
 * examples in the specs, which is what makes SC-010 checkable: if a state name
 * had to be known in advance, these tests could not have been written.
 */

import { describe, expect, it } from 'vitest';

import { blockingFailure, deriveProgress, stateProgress } from '@core/engine/progress';
import { UNMAPPED } from '@core/model/observed';

import { lifecycle, result, sixStageLifecycle } from '../support/lifecycle';

const definition = sixStageLifecycle();

function progressOf(currentStateId: string, results = [] as ReturnType<typeof result>[]) {
  return [...deriveProgress(definition, currentStateId, results).entries()].map(([id, value]) => `${id}:${value}`);
}

describe('deriveProgress', () => {
  it('marks earlier states completed, the occupied state current, and later states not reached', () => {
    // The item sits in the fourth of six states — quickstart V3 exactly.
    expect(progressOf('dispatch')).toEqual([
      'intake:completed',
      'appraisal:completed',
      'consent:completed',
      'dispatch:current',
      'transit:not_reached',
      'settled:not_reached',
    ]);
  });

  it('marks the occupied state blocked when one of its blocking gates failed', () => {
    const progress = deriveProgress(definition, 'dispatch', [result('weighed', 'failed', 'over the limit')]);
    expect(progress.get('dispatch')).toBe('blocked');
  });

  it('leaves the state current when a failed gate is non-blocking', () => {
    // `labelled` is declared blocking: false — reported, but it does not stall.
    const progress = deriveProgress(definition, 'dispatch', [result('labelled', 'failed')]);
    expect(progress.get('dispatch')).toBe('current');
  });

  it('leaves the state current when a blocking gate is merely unevaluated', () => {
    // Not evaluated is not a failure. "We have not checked" and "the check said
    // no" are different facts and must not render the same.
    const progress = deriveProgress(definition, 'dispatch', [result('weighed', 'not_evaluated')]);
    expect(progress.get('dispatch')).toBe('current');
  });

  it('does not mark earlier states blocked, whatever their gates now say', () => {
    const progress = deriveProgress(definition, 'dispatch', [result('valued', 'failed'), result('signed-off', 'failed')]);
    expect(progress.get('appraisal')).toBe('completed');
    expect(progress.get('consent')).toBe('completed');
  });

  it('marks the first state current with nothing completed behind it', () => {
    expect(progressOf('intake')).toEqual([
      'intake:current',
      'appraisal:not_reached',
      'consent:not_reached',
      'dispatch:not_reached',
      'transit:not_reached',
      'settled:not_reached',
    ]);
  });

  it('marks every earlier state completed when the item reaches the terminal state', () => {
    const progress = deriveProgress(definition, 'settled', []);
    expect(progress.get('settled')).toBe('current');
    expect(progress.get('transit')).toBe('completed');
    expect(progress.get('intake')).toBe('completed');
  });

  it('covers every declared state, so no tab can render without a status', () => {
    expect(deriveProgress(definition, 'dispatch', []).size).toBe(definition.states.length);
  });

  it('reaches no conclusion for an unmapped item — nothing is honestly completed', () => {
    const progress = deriveProgress(definition, UNMAPPED, []);
    expect([...progress.values()].every((value) => value === 'not_reached')).toBe(true);
  });

  it('reaches no conclusion for a state removed by a package upgrade (FR-046)', () => {
    const progress = deriveProgress(definition, 'a-state-removed-by-an-upgrade', []);
    expect([...progress.values()].every((value) => value === 'not_reached')).toBe(true);
  });

  it('derives order from array position alone, not from any name', () => {
    const reversed = lifecycle({ states: [{ id: 'settled' }, { id: 'dispatch' }, { id: 'intake' }] });
    const progress = deriveProgress(reversed, 'dispatch', []);
    expect(progress.get('settled')).toBe('completed');
    expect(progress.get('intake')).toBe('not_reached');
  });
});

describe('blockingFailure — what "stalled" means', () => {
  it('finds the blocking gate that failed', () => {
    const dispatch = definition.states[3]!;
    expect(blockingFailure(dispatch, [result('weighed', 'failed')])?.gateId).toBe('weighed');
  });

  it('ignores a non-blocking failure', () => {
    const dispatch = definition.states[3]!;
    expect(blockingFailure(dispatch, [result('labelled', 'failed')])).toBeUndefined();
  });

  it('ignores an unevaluated blocking gate', () => {
    const dispatch = definition.states[3]!;
    expect(blockingFailure(dispatch, [result('weighed', 'not_evaluated')])).toBeUndefined();
  });

  it('returns undefined for a state with no gates', () => {
    expect(blockingFailure(definition.states[0]!, [])).toBeUndefined();
  });
});

describe('stateProgress for a single state', () => {
  it('agrees with deriveProgress', () => {
    const dispatch = definition.states[3]!;
    const results = [result('weighed', 'failed')];
    expect(stateProgress(definition, 'dispatch', dispatch, results)).toBe(deriveProgress(definition, 'dispatch', results).get('dispatch'));
  });
});
