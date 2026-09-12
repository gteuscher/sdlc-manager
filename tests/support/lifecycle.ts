/**
 * A lifecycle the application has never seen, invented by the tests.
 *
 * This exists to make SC-003 and SC-010 testable rather than asserted: if the
 * engine can only be tested against a lifecycle that resembles the one in the
 * contract's example, nothing proves it is generic over lifecycles. So the states
 * here are deliberately unlike anything in the specs — no "spec", no "build", no
 * "release" — and the tests refer to them only through the definition.
 */

import type {
  ArtifactDecl,
  Condition,
  GateDecl,
  GateKind,
  ProviderDecl,
  SdlcDefinition,
  State,
} from '@core/model/declared';
import type { GateResult, GateStatus } from '@core/model/observed';

export interface GateSpec {
  id: string;
  name?: string;
  kind?: GateKind;
  blocking?: boolean;
  awaitsHuman?: boolean;
  configurable?: boolean;
  provider?: string;
  passesWhen?: Condition;
}

export interface StateSpec {
  id: string;
  name?: string;
  awaitsHuman?: boolean;
  terminal?: boolean;
  maps?: Record<string, string[]>;
  gates?: GateSpec[];
  artifacts?: ArtifactDecl[];
}

export interface LifecycleSpec {
  states: StateSpec[];
  providers?: ProviderDecl[];
  owner?: string;
  unit?: string;
}

export function gate(spec: GateSpec): GateDecl {
  const decl: { -readonly [K in keyof GateDecl]: GateDecl[K] } = {
    id: spec.id,
    name: spec.name ?? spec.id,
    kind: spec.kind ?? 'field',
    blocking: spec.blocking ?? true,
    awaitsHuman: spec.awaitsHuman ?? false,
    configurable: spec.configurable ?? false,
  };
  if (spec.provider !== undefined) decl.provider = spec.provider;
  if (spec.passesWhen !== undefined) decl.passesWhen = spec.passesWhen;
  if (decl.kind === 'manual') decl.evidence = { provider: spec.provider ?? 'ledger', field: `decisions.${spec.id}` };
  return decl;
}

export function lifecycle(spec: LifecycleSpec): SdlcDefinition {
  const owner = spec.owner ?? 'ledger';
  const providers: ProviderDecl[] = spec.providers ?? [{ id: owner, kind: 'memo', settings: {} }];

  const states: State[] = spec.states.map((state, index) => ({
    id: state.id,
    name: state.name ?? state.id,
    awaitsHuman: state.awaitsHuman ?? false,
    terminal: state.terminal ?? false,
    maps: state.maps ?? { [owner]: [state.id] },
    artifacts: state.artifacts ?? [],
    gates: (state.gates ?? []).map(gate),
    ordinal: index,
  }));

  return {
    states,
    transitions: [],
    providers,
    ownership: { state: owner, title: owner, artifacts: owner },
    items: {
      unit: spec.unit ?? 'parcel',
      discover: [{ provider: owner, glob: '*' }],
      identity: { correlateOn: 'tag', patterns: {}, fields: ['tag'] },
    },
    writeBack: { transitions: false, gateResults: false, records: null },
    repoConfig: [],
  };
}

/**
 * A six-state lifecycle with gates of all four kinds, matching the shape quickstart
 * V3 walks through — but with a vocabulary this project has never used.
 */
export function sixStageLifecycle(): SdlcDefinition {
  return lifecycle({
    unit: 'parcel',
    states: [
      { id: 'intake', name: 'Intake' },
      {
        id: 'appraisal',
        name: 'Appraisal',
        gates: [{ id: 'valued', name: 'Valuation recorded', kind: 'field', provider: 'ledger', passesWhen: { present: true } }],
      },
      {
        id: 'consent',
        name: 'Consent',
        awaitsHuman: true,
        gates: [{ id: 'signed-off', name: 'Owner signed off', kind: 'manual', awaitsHuman: true }],
      },
      {
        id: 'dispatch',
        name: 'Dispatch',
        gates: [
          { id: 'weighed', name: 'Weight verified', kind: 'check', provider: 'ledger' },
          { id: 'labelled', name: 'Label attached', kind: 'artifact', provider: 'ledger', passesWhen: { present: true }, blocking: false },
        ],
      },
      { id: 'transit', name: 'In transit' },
      { id: 'settled', name: 'Settled', terminal: true },
    ],
  });
}

export function result(gateId: string, status: GateStatus, detail: string | null = null): GateResult {
  return {
    gateId,
    status,
    evaluatedAt: status === 'not_evaluated' ? null : '2026-09-11T12:00:00.000Z',
    evidence: null,
    detail,
  };
}
