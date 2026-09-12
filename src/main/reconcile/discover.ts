/**
 * T062, T071 — item discovery, de-duplication, and provider disagreement.
 *
 * ## Discovery (FR-001, FR-001a, SC-012)
 *
 * A manifest's `items.discover` block is a list of rules, each naming the provider
 * that supplies items under it. Every rule runs through its provider, and the
 * results are keyed by the manifest's correlation field — which is what a
 * provider's `RawItem.key` already is, because `items.identity` is what extracted
 * it.
 *
 * The de-duplication is the requirement, not an optimisation: FR-001a says an item
 * qualifying under *any* of its workflow's providers is listed **once, not once
 * per qualifying provider**, and SC-012 measures it. A story with a markdown file
 * in the repository and a ticket assigned in a tracker is one item.
 *
 * ## Disagreement (T071, spec §Edge Cases "Two providers disagree")
 *
 * When the two providers describing one item report different values for one
 * field, the provider the manifest's `ownership` block declares the owner wins,
 * **and the disagreement is recorded rather than hidden**. That second half is the
 * part worth stating: silently taking the owner's value would make a genuinely
 * divergent tracker and repository look consistent, which is the failure the spec
 * calls out.
 *
 * There is deliberately **no runtime tie-break** beyond consulting `ownership`.
 * Two providers claiming one field is a manifest validation error (Principle VI,
 * FR-048), so the ambiguous case cannot reach this module; conflict resolution
 * here would be code for a state the loader already refuses.
 *
 * ## Failures
 *
 * One provider failing its discovery rule removes that provider's items, never
 * another's (Principle III, FR-037, SC-007). The failure is returned alongside the
 * items so that `assemble` can mark exactly the affected items stale — and not the
 * rest.
 */

import type { OwnedField, ProviderId, SdlcDefinition } from '@core/model/declared.js';
import type { ItemKey, ProviderDisagreement } from '@core/model/observed.js';
import type { FailureReason } from '@core/model/result.js';
import type { Provider, RawItem, RepoContext } from '@providers/contract.js';

/** Looks an adapter up by the id a manifest declares. `undefined` when unsupported. */
export type ProviderLookup = (id: ProviderId) => Provider | undefined;

/** Why one provider contributed nothing. Carries no credential and no stack. */
export interface ProviderFailure {
  readonly providerId: ProviderId;
  readonly reason: FailureReason;
  /** Actionable, and safe to render: it is what the adapter already wrote. */
  readonly message: string;
}

/**
 * One item, with every provider's account of it.
 *
 * `contributions` is in manifest declaration order, which is what makes the
 * merge below deterministic when the declared owner supplied nothing.
 */
export interface DiscoveredItem {
  readonly key: ItemKey;
  readonly contributions: readonly RawItem[];
  readonly sources: readonly ProviderId[];
}

export interface Discovery {
  readonly items: readonly DiscoveredItem[];
  /** Providers whose discovery rule succeeded. */
  readonly healthy: readonly ProviderId[];
  /** Providers whose discovery rule failed, or whose adapter is absent. */
  readonly failures: readonly ProviderFailure[];
}

/**
 * Runs every `items.discover` rule through its provider and de-duplicates by
 * correlation key.
 *
 * Never rejects. A provider that throws has broken rule 1 of the provider
 * contract; it is absorbed into a `ProviderFailure` so that one misbehaving
 * adapter cannot empty the item list.
 */
export async function discoverItems(
  ctx: RepoContext,
  lookup: ProviderLookup,
): Promise<Discovery> {
  const byKey = new Map<ItemKey, RawItem[]>();
  const healthy: ProviderId[] = [];
  const failures: ProviderFailure[] = [];

  // One provider may carry several discovery rules; its adapter reads them all in
  // one pass, so it is asked once. Declaration order is preserved.
  const providerIds: ProviderId[] = [];
  for (const rule of ctx.definition.items.discover) {
    if (!providerIds.includes(rule.provider)) providerIds.push(rule.provider);
  }

  for (const providerId of providerIds) {
    const provider = lookup(providerId);
    if (provider === undefined) {
      failures.push({
        providerId,
        reason: 'unavailable',
        message:
          `The '${providerId}' provider supplies items for this lifecycle but this build has no ` +
          'adapter for the kind its manifest declares. Items it would supply are absent; items ' +
          'from the other providers are unaffected.',
      });
      continue;
    }

    let discovered: readonly RawItem[];
    try {
      const result = await provider.discoverItems(ctx);
      if (!result.ok) {
        failures.push({ providerId, reason: result.reason, message: result.message });
        continue;
      }
      discovered = result.value;
    } catch (error) {
      failures.push({
        providerId,
        reason: 'invalid_response',
        message:
          `The '${providerId}' provider failed unexpectedly while listing items: ` +
          `${describeError(error)}. Items from the other providers are unaffected.`,
      });
      continue;
    }

    healthy.push(providerId);

    for (const raw of discovered) {
      const key = raw.key;
      if (key === '') continue;
      const contributions = byKey.get(key);
      if (contributions === undefined) {
        byKey.set(key, [{ ...raw, source: raw.source === '' ? providerId : raw.source }]);
        continue;
      }
      // Once per item, not once per qualifying provider (FR-001a, SC-012). A
      // second account of the same key is an additional *contribution* to one
      // item, never a second row.
      if (contributions.some((existing) => existing.source === providerId)) continue;
      contributions.push({ ...raw, source: raw.source === '' ? providerId : raw.source });
    }
  }

  const items: DiscoveredItem[] = [];
  for (const [key, contributions] of byKey) {
    items.push({
      key,
      contributions,
      sources: contributions.map((contribution) => contribution.source),
    });
  }

  return { items, healthy, failures };
}

/** One field's resolution: the value used, who supplied it, and what was overruled. */
export interface FieldResolution {
  readonly value: string | undefined;
  readonly winner: ProviderId | undefined;
  readonly disagreement: ProviderDisagreement | null;
}

/** The merged account of one item, before any state resolution or gate evaluation. */
export interface MergedItem {
  readonly key: ItemKey;
  readonly title: FieldResolution;
  readonly rawState: FieldResolution;
  readonly assignee: FieldResolution;
  /** Identity fields for `{item.<field>}` templating, owner's values winning. */
  readonly fields: Readonly<Record<string, string>>;
  readonly disagreements: readonly ProviderDisagreement[];
  readonly sources: readonly ProviderId[];
}

/**
 * Merges every provider's account of one item under the manifest's `ownership`.
 *
 * The owner's value is used. A differing value from any other provider is
 * recorded in `disagreements` rather than discarded, so the interface can show
 * that the two systems disagree instead of quietly presenting one of them.
 */
export function mergeContributions(
  definition: SdlcDefinition,
  discovered: DiscoveredItem,
): MergedItem {
  const title = resolveOwnedField(
    'title',
    definition.ownership.title,
    discovered.contributions,
    (raw) => raw.title,
  );
  const rawState = resolveOwnedField(
    'state',
    definition.ownership.state,
    discovered.contributions,
    (raw) => raw.rawState,
  );
  const assignee = resolveOwnedField(
    'assignee',
    definition.ownership.assignee,
    discovered.contributions,
    (raw) => raw.assignee,
  );

  const disagreements = [title, rawState, assignee]
    .map((resolution) => resolution.disagreement)
    .filter((entry): entry is ProviderDisagreement => entry !== null);

  return {
    key: discovered.key,
    title,
    rawState,
    assignee,
    fields: mergeFields(definition, discovered),
    disagreements,
    sources: discovered.sources,
  };
}

/**
 * Applies one field's ownership rule.
 *
 * The declared owner wins outright when it supplied a value. When it supplied
 * none — an owner whose discovery rule failed, or one that simply does not report
 * that field — the first contributor in manifest declaration order supplies the
 * value, and `winner` names *that* provider rather than the declared owner,
 * because `winner` records whose value is actually being shown.
 */
export function resolveOwnedField(
  field: OwnedField,
  owner: ProviderId | undefined,
  contributions: readonly RawItem[],
  valueOf: (raw: RawItem) => string | undefined,
): FieldResolution {
  const offered: { provider: ProviderId; value: string }[] = [];
  for (const contribution of contributions) {
    const value = valueOf(contribution);
    if (value === undefined || value === '') continue;
    offered.push({ provider: contribution.source, value });
  }

  if (offered.length === 0) {
    return { value: undefined, winner: undefined, disagreement: null };
  }

  const owned = owner === undefined ? undefined : offered.find((entry) => entry.provider === owner);
  const chosen = owned ?? offered[0];
  if (chosen === undefined) {
    return { value: undefined, winner: undefined, disagreement: null };
  }

  // Only a *differing* value is a disagreement. Two providers reporting the same
  // thing agree, however many of them there are.
  const others = offered.filter(
    (entry) => entry.provider !== chosen.provider && entry.value !== chosen.value,
  );

  if (others.length === 0) {
    return { value: chosen.value, winner: chosen.provider, disagreement: null };
  }

  return {
    value: chosen.value,
    winner: chosen.provider,
    disagreement: {
      field,
      winner: chosen.provider,
      winningValue: chosen.value,
      others: others.map((entry) => ({ provider: entry.provider, value: entry.value })),
    },
  };
}

/**
 * Identity fields for locator templating.
 *
 * Every provider's extracted fields are available, but where two providers
 * extracted the same field name, the state owner's value wins — a locator
 * templated with the wrong provider's idea of an identity field reads the wrong
 * file. `key` is always present, because it is the correlation identity itself.
 */
function mergeFields(
  definition: SdlcDefinition,
  discovered: DiscoveredItem,
): Record<string, string> {
  const owner = definition.ownership.state;
  const fields: Record<string, string> = {};

  const ordered = [...discovered.contributions].sort((left, right) => {
    if (left.source === right.source) return 0;
    if (left.source === owner) return 1;
    if (right.source === owner) return -1;
    return 0;
  });

  for (const contribution of ordered) {
    for (const [name, value] of Object.entries(contribution.fields)) {
      if (typeof value !== 'string' || value === '') continue;
      fields[name] = value;
    }
  }

  fields['key'] = discovered.key;
  const correlateOn = definition.items.identity.correlateOn;
  if (correlateOn !== '' && fields[correlateOn] === undefined) {
    fields[correlateOn] = discovered.key;
  }
  return fields;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
