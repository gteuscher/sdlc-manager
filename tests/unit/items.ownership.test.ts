/**
 * T058 — ownership scoping and de-duplication (FR-001a, SC-012).
 *
 * Two requirements meet here, and the second is the one that produces a visibly
 * broken product when it is missed.
 *
 * **Scoping.** The list is the engineer's own work, and ownership is a
 * *per-provider* rule rather than one global one (spec §Assumptions): a
 * tracker-backed item is theirs because the tracker says it is assigned to them;
 * a file-backed item is theirs because the declared markdown artifacts exist in
 * their repository. A workflow composing both can qualify an item either way.
 *
 * **De-duplication.** "An item qualifying under any of its workflow's providers
 * MUST be listed **once, not once per qualifying provider**." A composed
 * lifecycle is the normal case, so getting this wrong doubles every row.
 */

import { describe, expect, it } from 'vitest';

import { discoverItems, mergeContributions, resolveOwnedField } from '@main/reconcile/discover';
import type { DiscoveredItem, ProviderLookup } from '@main/reconcile/discover';
import type { SdlcDefinition } from '@core/model/declared';
import type { Provider, RawItem, RepoContext } from '@providers/contract';
import { fail, ok } from '@core/model/result';

import { lifecycle } from '../support/lifecycle';

/** A lifecycle composing two providers: one owns state and title, the other artifacts. */
function composed(): SdlcDefinition {
  const base = lifecycle({
    owner: 'ledger',
    providers: [
      { id: 'ledger', kind: 'memo', settings: {} },
      { id: 'depot', kind: 'memo', settings: {} },
    ],
    states: [
      { id: 'intake', maps: { ledger: ['alpha'], depot: ['one'] } },
      { id: 'dispatch', maps: { ledger: ['beta'], depot: ['two'] } },
    ],
  });

  return {
    ...base,
    ownership: { state: 'ledger', title: 'ledger', artifacts: 'depot', assignee: 'ledger' },
    items: {
      ...base.items,
      discover: [
        { provider: 'ledger', query: 'assignee = currentUser()' },
        { provider: 'depot', glob: 'records/*/parcel.md' },
      ],
    },
  };
}

function context(definition: SdlcDefinition): RepoContext {
  return { repositoryId: 'depot', repositoryPath: '/depot', definition, config: {} };
}

/** A provider that only answers discovery; everything else is unreachable here. */
function discoveryOnly(id: string, items: RawItem[] | 'fail'): Provider {
  return {
    id,
    kind: 'memo',
    health: async () => ({ providerId: id, kind: 'memo', status: 'ok', message: 'ok', checkedAt: '2026-09-11T00:00:00.000Z' }),
    discoverItems: async () => (items === 'fail' ? fail('unreachable', `${id} did not answer`) : ok(items)),
    readState: async () => fail('not_found', 'not used'),
    readArtifact: async () => fail('not_found', 'not used'),
    readGate: async () => fail('not_found', 'not used'),
    subscribe: () => () => undefined,
  };
}

function raw(source: string, key: string, extra: Partial<RawItem> = {}): RawItem {
  return { key, source, fields: { key }, ...extra };
}

function lookupOf(providers: Record<string, Provider | undefined>): ProviderLookup {
  return (id) => providers[id];
}

/** One item as discovery hands it to the merge step. */
function discovered(key: string, contributions: RawItem[]): DiscoveredItem {
  return { key, contributions, sources: contributions.map((entry) => entry.source) };
}

describe('an item qualifying under two providers is listed once (FR-001a, SC-012)', () => {
  it('de-duplicates by correlation key', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({
        ledger: discoveryOnly('ledger', [raw('ledger', 'P-1', { title: 'First', rawState: 'alpha' })]),
        depot: discoveryOnly('depot', [raw('depot', 'P-1', { rawState: 'one' })]),
      }),
    );

    // One row, not one per qualifying provider.
    expect(discovery.items).toHaveLength(1);
    expect(discovery.items[0]?.key).toBe('P-1');
  });

  it('retains the account each provider gave of the item, rather than discarding one', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({
        ledger: discoveryOnly('ledger', [raw('ledger', 'P-1', { rawState: 'alpha' })]),
        depot: discoveryOnly('depot', [raw('depot', 'P-1', { rawState: 'one' })]),
      }),
    );

    // De-duplicating the row must not throw away the evidence that the two
    // providers disagree — that is what the ownership rule then resolves.
    expect(discovery.items[0]?.contributions).toHaveLength(2);
    expect([...(discovery.items[0]?.sources ?? [])].sort()).toEqual(['depot', 'ledger']);
  });

  it('lists an item qualifying under only the tracker', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({
        ledger: discoveryOnly('ledger', [raw('ledger', 'P-2', { rawState: 'alpha' })]),
        depot: discoveryOnly('depot', []),
      }),
    );
    expect(discovery.items.map((item) => item.key)).toEqual(['P-2']);
  });

  it('lists an item qualifying under only the file-backed provider', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({
        ledger: discoveryOnly('ledger', []),
        depot: discoveryOnly('depot', [raw('depot', 'P-3', { rawState: 'one' })]),
      }),
    );
    expect(discovery.items.map((item) => item.key)).toEqual(['P-3']);
  });

  it('lists nothing the engineer neither owns in the tracker nor holds artifacts for (SC-012)', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({ ledger: discoveryOnly('ledger', []), depot: discoveryOnly('depot', []) }),
    );
    // Every listed item qualifies under a stated rule; nothing else appears.
    expect(discovery.items).toEqual([]);
  });

  it('asks each provider once even when it carries several discovery rules', async () => {
    const base = composed();
    const definition: SdlcDefinition = {
      ...base,
      items: {
        ...base.items,
        discover: [
          { provider: 'ledger', query: 'one' },
          { provider: 'ledger', query: 'two' },
          { provider: 'depot', glob: 'records/*/parcel.md' },
        ],
      },
    };

    let ledgerCalls = 0;
    const ledger = discoveryOnly('ledger', [raw('ledger', 'P-1')]);
    const counting: Provider = {
      ...ledger,
      discoverItems: async (ctx) => {
        ledgerCalls += 1;
        return ledger.discoverItems(ctx);
      },
    };

    await discoverItems(context(definition), lookupOf({ ledger: counting, depot: discoveryOnly('depot', []) }));
    expect(ledgerCalls).toBe(1);
  });
});

describe('one failing provider does not remove the items of another (FR-037, SC-007)', () => {
  it('keeps the items from the healthy provider and reports the failure by name', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({
        ledger: discoveryOnly('ledger', [raw('ledger', 'P-1', { rawState: 'alpha' })]),
        depot: discoveryOnly('depot', 'fail'),
      }),
    );

    expect(discovery.items.map((item) => item.key)).toEqual(['P-1']);
    expect(discovery.healthy).toContain('ledger');
    expect(discovery.failures.map((failure) => failure.providerId)).toContain('depot');
  });

  it('carries an actionable reason and no stack', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({ ledger: discoveryOnly('ledger', []), depot: discoveryOnly('depot', 'fail') }),
    );

    const failure = discovery.failures[0];
    expect(failure?.reason).toBe('unreachable');
    expect(failure?.message).toContain('depot');
    expect(JSON.stringify(failure)).not.toContain('    at ');
  });

  it('absorbs an adapter that throws, which has broken the contract', async () => {
    const definition = composed();
    const exploding: Provider = {
      ...discoveryOnly('depot', []),
      discoverItems: async () => {
        throw new Error('adapter exploded');
      },
    };

    const discovery = await discoverItems(
      context(definition),
      lookupOf({ ledger: discoveryOnly('ledger', [raw('ledger', 'P-1')]), depot: exploding }),
    );

    // One misbehaving adapter must not take down unrelated parts of the dashboard.
    expect(discovery.items.map((item) => item.key)).toEqual(['P-1']);
    expect(discovery.failures.map((failure) => failure.providerId)).toContain('depot');
  });

  it('reports an absent adapter rather than silently listing nothing', async () => {
    const definition = composed();
    const discovery = await discoverItems(
      context(definition),
      lookupOf({ ledger: discoveryOnly('ledger', [raw('ledger', 'P-1')]), depot: undefined }),
    );
    expect(discovery.failures.map((failure) => failure.providerId)).toContain('depot');
  });
});

describe('ownership decides which provider wins, and the disagreement is surfaced', () => {
  it('takes the value from the owning provider', () => {
    const definition = composed();
    const merged = mergeContributions(definition, discovered('P-1', [
      raw('ledger', 'P-1', { title: 'Ledger title', rawState: 'alpha' }),
      raw('depot', 'P-1', { title: 'Depot title', rawState: 'one' }),
    ]));

    // `ownership.title` names ledger, so that value is shown. There is no
    // runtime tie-break beyond consulting the manifest.
    expect(merged.title.value).toBe('Ledger title');
    expect(merged.title.winner).toBe('ledger');
  });

  it('shows the disagreement rather than hiding it (spec §Edge Cases)', () => {
    const definition = composed();
    const merged = mergeContributions(definition, discovered('P-1', [
      raw('ledger', 'P-1', { title: 'Ledger title', rawState: 'alpha' }),
      raw('depot', 'P-1', { title: 'Depot title', rawState: 'one' }),
    ]));

    const titleDisagreement = merged.disagreements.find((entry) => entry.field === 'title');
    expect(titleDisagreement?.winner).toBe('ledger');
    expect(titleDisagreement?.others.map((other) => other.provider)).toContain('depot');
  });

  it('records no disagreement when the providers agree', () => {
    const definition = composed();
    const merged = mergeContributions(definition, discovered('P-1', [
      raw('ledger', 'P-1', { title: 'Same', rawState: 'alpha' }),
      raw('depot', 'P-1', { title: 'Same' }),
    ]));
    expect(merged.disagreements.filter((entry) => entry.field === 'title')).toEqual([]);
  });

  it('records no disagreement when only one provider supplied a value', () => {
    const definition = composed();
    const merged = mergeContributions(definition, discovered('P-1', [
      raw('ledger', 'P-1', { title: 'Only one', rawState: 'alpha' }),
      raw('depot', 'P-1'),
    ]));
    expect(merged.disagreements.filter((entry) => entry.field === 'title')).toEqual([]);
  });

  it('falls back to a contributing provider when the declared owner supplied nothing', () => {
    const definition = composed();
    const resolution = resolveOwnedField(
      'title',
      definition.ownership.title,
      [raw('ledger', 'P-1'), raw('depot', 'P-1', { title: 'Depot title' })],
      (contribution) => contribution.title,
    );

    // Showing nothing because the owner was silent would be worse than showing
    // what is known and naming where it came from.
    expect(resolution.value).toBe('Depot title');
    expect(resolution.winner).toBe('depot');
  });
});
