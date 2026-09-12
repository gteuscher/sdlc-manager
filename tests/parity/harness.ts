/**
 * T052 — the provider-parity harness. Gate 5.
 *
 * ## What this suite is for
 *
 * It runs the engine's behavioural suite against every provider fake
 * **unmodified**. Read that as the diagnostic it is:
 *
 *   A test that passes for one provider and fails for another does **not**
 *   indicate a provider bug. It indicates that provider-specific knowledge has
 *   leaked into the engine — which is exactly the failure Principle IV names.
 *
 * So when this suite goes red for one fake only, do not start by fixing the fake.
 * Start by asking what the engine now knows about a particular provider that it
 * should not. The suite is a coupling detector, not a compatibility check
 * (contracts/provider-interface.md §3).
 *
 * ## Why the seed lives here
 *
 * Every fake is driven from the same seed and the same invented lifecycle, so any
 * difference in outcome is attributable to the code under test rather than to the
 * fixtures. The lifecycle's vocabulary is deliberately unlike anything in the
 * specs: if the engine could only be exercised against a familiar-looking
 * lifecycle, nothing here would prove it is generic over lifecycles (SC-003,
 * SC-010).
 */

import { describe, expect, it } from 'vitest';

import { deriveAttention } from '@core/engine/attention';
import { evaluateStateGates } from '@core/engine/evaluateGate';
import { deriveProgress } from '@core/engine/progress';
import { resolveState } from '@core/engine/resolveState';
import type { ArtifactDecl, SdlcDefinition } from '@core/model/declared';
import { isUnmapped } from '@core/model/observed';
import type { Provider, RepoContext } from '@providers/contract';
import type { FakeControls, FakeOptions, FakeSeed } from '@providers/fakes/base';

import { lifecycle } from '../support/lifecycle';

export type FakeFactory = (options: FakeOptions) => Provider & FakeControls;

/** The one provider id every fake is given, so results are comparable across them. */
export const PROVIDER_ID = 'ledger';

function artifact(id: string): ArtifactDecl {
  return {
    id,
    name: id,
    kind: 'markdown',
    provider: PROVIDER_ID,
    locator: { provider: PROVIDER_ID, path: `records/{item.key}/${id}.md` },
    required: false,
  };
}

/** A lifecycle this project has never used, so nothing can be recognised by name. */
export function parityLifecycle(): SdlcDefinition {
  return lifecycle({
    owner: PROVIDER_ID,
    unit: 'parcel',
    states: [
      {
        id: 'intake',
        name: 'Intake',
        maps: { [PROVIDER_ID]: ['alpha'] },
        artifacts: [artifact('valuation')],
        gates: [{ id: 'appraised', name: 'Appraisal recorded', kind: 'field', provider: PROVIDER_ID, passesWhen: { present: true } }],
      },
      {
        id: 'dispatch',
        name: 'Dispatch',
        maps: { [PROVIDER_ID]: ['beta'] },
        gates: [{ id: 'weighed', name: 'Weight verified', kind: 'check', provider: PROVIDER_ID, blocking: true }],
      },
      {
        id: 'transit',
        name: 'In transit',
        maps: { [PROVIDER_ID]: ['gamma'] },
        gates: [{ id: 'signed', name: 'Handover signed', kind: 'manual', awaitsHuman: true, provider: PROVIDER_ID }],
      },
      { id: 'settled', name: 'Settled', terminal: true, maps: { [PROVIDER_ID]: ['delta'] } },
    ],
  });
}

export function paritySeed(): FakeSeed {
  return {
    items: [
      {
        key: 'P-1',
        title: 'First parcel',
        rawState: 'alpha',
        fields: { key: 'P-1' },
        artifacts: { valuation: '# Valuation\n\nAssessed and recorded.\n' },
        gates: { appraised: 'passed' },
      },
      {
        key: 'P-2',
        title: 'Second parcel',
        rawState: 'beta',
        fields: { key: 'P-2' },
        gates: { weighed: 'failed' },
      },
      {
        // Nothing recorded. Every gate must come back not_evaluated, never passed.
        key: 'P-3',
        title: 'Third parcel',
        rawState: 'gamma',
        fields: { key: 'P-3' },
      },
      {
        // A raw value this lifecycle does not declare (FR-005).
        key: 'P-4',
        title: 'Fourth parcel',
        rawState: 'omega',
        fields: { key: 'P-4' },
      },
    ],
  };
}

export function parityContext(definition: SdlcDefinition): RepoContext {
  return {
    repositoryId: 'depot',
    repositoryPath: '/depot',
    definition,
    config: {},
  };
}

function build(factory: FakeFactory): Provider & FakeControls {
  return factory({
    decl: { id: PROVIDER_ID, kind: 'fake', settings: {} },
    seed: paritySeed(),
  });
}

/**
 * The outcome of running the whole engine pipeline over one provider.
 *
 * Deliberately free of anything provider-specific — no kind, no message text —
 * because the parity assertion is that two different adapters produce the *same*
 * lifecycle facts, not the same prose.
 */
export interface PipelineOutcome {
  key: string;
  stateId: string;
  unmapped: boolean;
  rawState: string;
  gates: { gateId: string; status: string }[];
  progress: string[];
  attention: string | null;
}

export async function runPipeline(provider: Provider): Promise<PipelineOutcome[]> {
  const definition = parityLifecycle();
  const ctx = parityContext(definition);

  const discovered = await provider.discoverItems(ctx);
  if (!discovered.ok) throw new Error(`discovery failed: ${discovered.message}`);

  const outcomes: PipelineOutcome[] = [];
  for (const raw of [...discovered.value].sort((left, right) => left.key.localeCompare(right.key))) {
    const state = await provider.readState(ctx, raw.key);
    const rawValue = state.ok ? state.value.value : '';
    const resolved = resolveState(definition, PROVIDER_ID, rawValue);

    const occupied = definition.states.find((candidate) => candidate.id === resolved.stateId);
    const gates = occupied === undefined ? [] : await evaluateStateGates(occupied, (decl) => provider.readGate(ctx, decl, raw.key));

    outcomes.push({
      key: raw.key,
      stateId: String(resolved.stateId),
      unmapped: isUnmapped(resolved.stateId),
      rawState: resolved.rawState,
      gates: gates.map((result) => ({ gateId: result.gateId, status: result.status })),
      progress: [...deriveProgress(definition, resolved.stateId, gates).values()],
      attention: deriveAttention(definition, resolved.stateId, gates)?.kind ?? null,
    });
  }
  return outcomes;
}

/**
 * The behavioural suite. Called once per fake, with no modification between
 * calls — that is the whole contract of this file.
 */
export function runEngineSuite(name: string, factory: FakeFactory): void {
  describe(`engine against the ${name} fake`, () => {
    const definition = parityLifecycle();
    const ctx = parityContext(definition);

    it('discovers every seeded item', async () => {
      const provider = build(factory);
      const discovered = await provider.discoverItems(ctx);
      expect(discovered.ok).toBe(true);
      if (!discovered.ok) return;
      expect(discovered.value.map((item) => item.key).sort()).toEqual(['P-1', 'P-2', 'P-3', 'P-4']);
    });

    it('returns raw vocabulary, never a declared state id', async () => {
      const provider = build(factory);
      const state = await provider.readState(ctx, 'P-1');
      expect(state.ok).toBe(true);
      if (!state.ok) return;
      // The provider must not know that "alpha" means anything.
      expect(state.value.value).toBe('alpha');
      expect(definition.states.map((candidate) => candidate.id)).not.toContain(state.value.value);
    });

    it('lets the engine resolve a declared raw value to its state', async () => {
      const outcomes = await runPipeline(build(factory));
      expect(outcomes.find((outcome) => outcome.key === 'P-1')?.stateId).toBe('intake');
    });

    it('leaves an undeclared raw value unmapped, retaining it (FR-005)', async () => {
      const outcomes = await runPipeline(build(factory));
      const fourth = outcomes.find((outcome) => outcome.key === 'P-4');
      expect(fourth?.unmapped).toBe(true);
      expect(fourth?.rawState).toBe('omega');
    });

    it('reports a recorded passing gate as passed', async () => {
      const outcomes = await runPipeline(build(factory));
      expect(outcomes.find((outcome) => outcome.key === 'P-1')?.gates).toEqual([{ gateId: 'appraised', status: 'passed' }]);
    });

    it('reports a recorded failing gate as failed, and the state as blocked', async () => {
      const outcomes = await runPipeline(build(factory));
      const second = outcomes.find((outcome) => outcome.key === 'P-2');
      expect(second?.gates).toEqual([{ gateId: 'weighed', status: 'failed' }]);
      expect(second?.progress[1]).toBe('blocked');
    });

    it('reports a gate with nothing recorded as not_evaluated, never passed (FR-014, SC-005)', async () => {
      const outcomes = await runPipeline(build(factory));
      expect(outcomes.find((outcome) => outcome.key === 'P-3')?.gates).toEqual([{ gateId: 'signed', status: 'not_evaluated' }]);
    });

    it('derives gate_failed and input_needed as distinct signals (FR-006)', async () => {
      const outcomes = await runPipeline(build(factory));
      expect(outcomes.find((outcome) => outcome.key === 'P-2')?.attention).toBe('gate_failed');
      expect(outcomes.find((outcome) => outcome.key === 'P-3')?.attention).toBe('input_needed');
      expect(outcomes.find((outcome) => outcome.key === 'P-1')?.attention).toBeNull();
    });

    it('reads a seeded artifact', async () => {
      const provider = build(factory);
      const decl = definition.states[0]?.artifacts[0];
      const content = await provider.readArtifact(ctx, decl!, 'P-1');
      expect(content.ok).toBe(true);
      if (!content.ok) return;
      expect(content.value.content).toContain('Valuation');
    });

    it('reports a missing artifact as a typed failure rather than empty content (FR-019)', async () => {
      const provider = build(factory);
      const decl = definition.states[0]?.artifacts[0];
      const content = await provider.readArtifact(ctx, decl!, 'P-3');
      expect(content.ok).toBe(false);
      if (content.ok) return;
      expect(content.reason).toBe('not_found');
    });

    it.each([
      ['unreachable', 'unreachable'],
      ['unauthenticated', 'unauthenticated'],
      ['rate_limited', 'rate_limited'],
      ['not_configured', 'not_configured'],
    ] as const)('reports the %s branch through health() without throwing', async (fault, expected) => {
      const provider = build(factory);
      provider.setFault(fault);
      await expect(provider.health()).resolves.toMatchObject({ status: expected });
    });

    it.each(['unreachable', 'unauthenticated', 'rate_limited', 'not_configured'] as const)(
      'returns a typed %s failure from every read rather than throwing (rule 1)',
      async (fault) => {
        const provider = build(factory);
        provider.setFault(fault);

        const discovered = await provider.discoverItems(ctx);
        const state = await provider.readState(ctx, 'P-1');
        expect(discovered.ok).toBe(false);
        expect(state.ok).toBe(false);
        if (!state.ok) expect(state.reason).toBe(fault);
      },
    );

    it('folds an unreadable gate to not_evaluated rather than losing the state', async () => {
      const provider = build(factory);
      provider.setFault('unreachable');
      const occupied = definition.states[0];
      const gates = await evaluateStateGates(occupied!, (decl) => provider.readGate(ctx, decl, 'P-1'));
      expect(gates.map((result) => result.status)).toEqual(['not_evaluated']);
    });

    it('produces a gate with no recorded result on demand', async () => {
      const provider = build(factory);
      provider.setFault('gate_unevaluated');
      const occupied = definition.states[0];
      const gates = await evaluateStateGates(occupied!, (decl) => provider.readGate(ctx, decl, 'P-1'));
      expect(gates[0]?.status).toBe('not_evaluated');
      expect(gates[0]?.evaluatedAt).toBeNull();
    });

    it('produces a missing artifact on demand', async () => {
      const provider = build(factory);
      provider.setFault('missing_artifact');
      const decl = definition.states[0]?.artifacts[0];
      await expect(provider.readArtifact(ctx, decl!, 'P-1')).resolves.toMatchObject({ ok: false });
    });

    it('notifies subscribers, and stops once unsubscribed', async () => {
      const provider = build(factory);
      let fired = 0;
      const unsubscribe = provider.subscribe(ctx, () => {
        fired += 1;
      });
      provider.emitChange();
      expect(fired).toBe(1);
      unsubscribe();
      provider.emitChange();
      expect(fired).toBe(1);
    });
  });
}
