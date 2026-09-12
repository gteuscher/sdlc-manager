/**
 * T033 — mapping a provider's raw value to a declared state.
 *
 * The mapping lives in the manifest, so this is the engine's job and not a
 * provider's (provider-interface.md rule 2). When no declaration matches, the
 * result is `UNMAPPED` with the raw value retained (FR-005). It is never coerced
 * to a nearby state: an item whose tracker reports a status the lifecycle does not
 * know is a fact about the lifecycle, and guessing would hide it.
 */

import type { ProviderId, SdlcDefinition } from '../model/declared.js';
import { UNMAPPED, type ResolvedStateId } from '../model/observed.js';

export interface StateResolution {
  readonly stateId: ResolvedStateId;
  /** Always retained, whether or not the mapping succeeded. */
  readonly rawState: string;
}

/**
 * Resolves the raw value reported by the provider that owns `state`.
 *
 * `owner` matters: a lifecycle composing a tracker and the filesystem has two raw
 * vocabularies, and a value means a state only within the vocabulary of the
 * provider that declared it.
 */
export function resolveState(
  definition: SdlcDefinition,
  owner: ProviderId,
  rawValue: string | undefined | null,
): StateResolution {
  const rawState = rawValue ?? '';
  if (rawState === '') return { stateId: UNMAPPED, rawState };

  for (const state of definition.states) {
    const values = state.maps[owner];
    if (values === undefined) continue;
    if (values.includes(rawState)) {
      return { stateId: state.id, rawState };
    }
  }

  return { stateId: UNMAPPED, rawState };
}

/**
 * True when the state id is one this definition still declares.
 *
 * Used after a package upgrade: an item whose recorded state vanished must be
 * marked unmapped rather than dropped or reassigned (FR-046).
 */
export function isDeclaredState(definition: SdlcDefinition, stateId: ResolvedStateId): boolean {
  return definition.states.some((state) => state.id === stateId);
}
