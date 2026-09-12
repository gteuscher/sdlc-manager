/**
 * T057 — two lifecycles in one list (FR-001, SC-003).
 *
 * This is the product's central claim, so it is worth being precise about what
 * would count as passing. Not "two repositories appear" — that is easy. The claim
 * is that each item resolves against **its own lifecycle's vocabulary**, and that
 * a lifecycle the application has never seen is adopted "with configuration
 * changes only, and no change to the application itself".
 *
 * The two lifecycles below therefore share no state id, no gate id, and no raw
 * value, and they have different state counts and different display nouns. If
 * anything in the engine had special knowledge of either, one of them would come
 * out wrong.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServices, type Services } from '@main/index';
import type { SafeStorageLike } from '@main/secrets/index';
import type { ProviderFactories } from '@main/providers';
import type { WorkItemSummary } from '@core/model/observed';
import { createFakeProvider, type FakeSeed } from '@providers/fakes/base';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc::${plain}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^enc::/, ''),
};

/** Four states, one display noun, one raw vocabulary. */
const PARCELS = `
sdlc: 1
id: parcels
name: Parcel Handling
version: 1.4.0
providers:
  - id: ledger
    kind: memo
ownership:
  state: ledger
  title: ledger
  artifacts: ledger
items:
  unit: parcel
  discover:
    - provider: ledger
      query: mine
  identity:
    correlate_on: key
states:
  - id: intake
    name: Intake
    maps: { ledger: ["alpha"] }
  - id: dispatch
    name: Dispatch
    awaits_human: true
    maps: { ledger: ["beta"] }
  - id: transit
    name: In transit
    maps: { ledger: ["gamma"] }
  - id: settled
    name: Settled
    terminal: true
    maps: { ledger: ["delta"] }
`;

/** Three states, a different noun, and a raw vocabulary that overlaps nothing. */
const CASES = `
sdlc: 1
id: casework
name: Casework
version: 0.2.0
providers:
  - id: registry
    kind: memo
ownership:
  state: registry
  title: registry
  artifacts: registry
items:
  unit: matter
  discover:
    - provider: registry
      query: mine
  identity:
    correlate_on: key
states:
  - id: lodged
    name: Lodged
    maps: { registry: ["one"] }
  - id: heard
    name: Heard
    maps: { registry: ["two"] }
    gates:
      - id: minuted
        name: Minutes recorded
        kind: field
        provider: registry
        field: minutes
        passes_when: { present: true }
  - id: closed
    name: Closed
    terminal: true
    maps: { registry: ["three"] }
`;

/**
 * The same lifecycle with its opening state withdrawn (004, FR-015).
 *
 * `alpha` is still what the ledger records for P-1, but no state claims it any
 * more, so the item becomes unmapped without anything about the item changing.
 * This is 001's FR-046 direction reused: the state vanished, the item did not.
 */
const PARCELS_WITHOUT_INTAKE = PARCELS.replace(
  '  - id: intake\n    name: Intake\n    maps: { ledger: ["alpha"] }\n',
  '',
);

/**
 * A manifest that parses as YAML and fails as a lifecycle (004, FR-016).
 *
 * It declares an id and a name and nothing else, so the package is discovered —
 * and therefore still associated with the repository that named it — while
 * carrying no definition at all.
 */
const PARCELS_UNREADABLE = `
sdlc: 1
id: parcels
name: Parcel Handling
`;

function parcelSeed(): FakeSeed {
  return {
    items: [
      { key: 'P-1', title: 'First parcel', rawState: 'alpha', fields: { key: 'P-1' } },
      { key: 'P-2', title: 'Second parcel', rawState: 'beta', fields: { key: 'P-2' } },
      // Resting in `settled`, which this lifecycle — and only this lifecycle —
      // declares terminal (004).
      { key: 'P-3', title: 'Delivered parcel', rawState: 'delta', fields: { key: 'P-3' } },
    ],
  };
}

function caseSeed(): FakeSeed {
  return {
    items: [
      { key: 'C-1', title: 'First matter', rawState: 'one', fields: { key: 'C-1' } },
      { key: 'C-2', title: 'Second matter', rawState: 'two', fields: { key: 'C-2' }, gates: { minuted: 'failed' } },
      // The other lifecycle's own terminal state, sharing no id and no raw value
      // with the one above. Two vocabularies, one rule.
      { key: 'C-3', title: 'Concluded case', rawState: 'three', fields: { key: 'C-3' } },
    ],
  };
}

/**
 * Each provider id gets its own seed. Both lifecycles use the same adapter kind,
 * which is the point: the adapter knows nothing about either vocabulary.
 */
function factories(): ProviderFactories {
  return {
    memo: (options) =>
      createFakeProvider('memo', {
        ...options,
        seed: options.decl.id === 'ledger' ? parcelSeed() : caseSeed(),
      }),
  };
}

let userDataDir: string;
let packageRoot: string;
let parcelRepo: string;
let caseRepo: string;
let services: Services | undefined;

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'sdlc-aggregate-'));
  packageRoot = await mkdtemp(join(tmpdir(), 'sdlc-aggregate-packages-'));
  parcelRepo = await mkdtemp(join(tmpdir(), 'sdlc-aggregate-depot-'));
  caseRepo = await mkdtemp(join(tmpdir(), 'sdlc-aggregate-registry-'));

  for (const [name, manifest] of [
    ['parcels', PARCELS],
    ['casework', CASES],
  ] as const) {
    const pkg = join(packageRoot, name);
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'sdlc.yaml'), manifest, 'utf8');
  }

  services = createServices({ userDataDir, safeStorage, packageRoots: [packageRoot], providerFactories: factories() });
  await services.start();

  for (const [name, path, packageId] of [
    ['depot', parcelRepo, 'parcels'],
    ['registry', caseRepo, 'casework'],
  ] as const) {
    const registered = await services.handlers.repositories.registerRepository({ name, path, packageId });
    expect(registered.ok, registered.ok ? '' : registered.message).toBe(true);
  }
});

afterEach(async () => {
  await services?.dispose().catch(() => undefined);
  services = undefined;
  for (const dir of [userDataDir, packageRoot, parcelRepo, caseRepo]) {
    await rm(dir, { recursive: true, force: true });
  }
});

function items() {
  return services!.handlers.items.listItems({});
}

// ── Reading a listing ────────────────────────────────────────────────────────

/** Sorted, so an assertion reads as a set. Ordering has its own test above. */
function keysOf(listed: readonly WorkItemSummary[]): string[] {
  return listed.map((item) => item.key).sort();
}

/**
 * The item, or a failure naming what was missing.
 *
 * Every 004 assertion below is really two claims — *this item is listed* and
 * *it answers thus* — and FR-015 and FR-016 are far more likely to fail on the
 * first. Reading through this helper makes the first claim load-bearing instead
 * of leaving it to an optional chain that quietly yields `undefined`.
 */
function listedAs(listed: readonly WorkItemSummary[], key: string): WorkItemSummary {
  const found = listed.find((item) => item.key === key);
  if (found === undefined) {
    throw new Error(`${key} was not listed; the listing held ${keysOf(listed).join(', ') || 'nothing'}`);
  }
  return found;
}

/**
 * Replaces the parcel lifecycle's manifest and re-reads the world.
 *
 * The unscoped refresh is the path that re-scans the installed packages before
 * reconciling, which is the only way to observe a definition changing underneath
 * items that are already discovered and cached. Nothing about the ledger's
 * records changes here — only what the lifecycle says about them.
 */
async function republishParcelLifecycle(manifest: string): Promise<void> {
  await writeFile(join(packageRoot, 'parcels', 'sdlc.yaml'), manifest, 'utf8');
  const refreshed = await services!.reconciler.refresh({});
  expect(refreshed.ok, refreshed.ok ? '' : refreshed.message).toBe(true);
}

describe('items from two different lifecycles appear in one list (FR-001)', () => {
  it('lists items from both repositories together', async () => {
    const listed = await items();
    const keys = listed.map((item) => item.key).sort();
    expect(keys).toEqual(['C-1', 'C-2', 'P-1', 'P-2']);
  });

  it('labels each item with the SDLC it follows', async () => {
    const listed = await items();
    expect(listed.find((item) => item.key === 'P-1')?.sdlcName).toBe('Parcel Handling');
    expect(listed.find((item) => item.key === 'C-1')?.sdlcName).toBe('Casework');
  });

  it('names each repository on its own items', async () => {
    const listed = await items();
    expect(listed.find((item) => item.key === 'P-1')?.repositoryName).toBe('depot');
    expect(listed.find((item) => item.key === 'C-1')?.repositoryName).toBe('registry');
  });
});

describe('each item resolves against its own vocabulary (SC-003, SC-010)', () => {
  it('resolves raw values that mean nothing in the other lifecycle', async () => {
    const listed = await items();
    // "alpha" is a state in one lifecycle and unknown in the other; "one" is the
    // reverse. Neither may leak across.
    expect(listed.find((item) => item.key === 'P-1')?.stateName).toBe('Intake');
    expect(listed.find((item) => item.key === 'C-1')?.stateName).toBe('Lodged');
  });

  it('uses each lifecycle display noun rather than a built-in one', async () => {
    const listed = await items();
    expect(listed.find((item) => item.key === 'P-1')?.unit).toBe('parcel');
    expect(listed.find((item) => item.key === 'C-1')?.unit).toBe('matter');
  });

  it('records the package version each repository follows (FR-043)', async () => {
    const repositories = await services!.handlers.repositories.listRepositories();
    const versions = Object.fromEntries(repositories.map((repository) => [repository.name, repository.packageVersion]));
    expect(versions['depot']).toBe('1.4.0');
    expect(versions['registry']).toBe('0.2.0');
  });

  it('gives each lifecycle its own state count in the detail view (FR-011)', async () => {
    const parcel = await services!.handlers.items.getItem({ key: 'P-1' });
    const matter = await services!.handlers.items.getItem({ key: 'C-1' });
    expect(parcel.ok && matter.ok).toBe(true);
    if (!parcel.ok || !matter.ok) return;

    expect(parcel.value.states).toHaveLength(4);
    expect(matter.value.states).toHaveLength(3);
  });

  it('shows only the gates the item lifecycle declares', async () => {
    const matter = await services!.handlers.items.getItem({ key: 'C-2' });
    expect(matter.ok).toBe(true);
    if (!matter.ok) return;

    const gateIds = matter.value.states.flatMap((state) => state.gates.map((gate) => gate.id));
    expect(gateIds).toEqual(['minuted']);
  });

  it('derives attention in both lifecycles from their own declarations (FR-006)', async () => {
    const listed = await items();
    // One lifecycle declares a state that awaits a human; the other declares a
    // gate that failed. Both signals come from the manifests, not from the code.
    expect(listed.find((item) => item.key === 'P-2')?.attention?.kind).toBe('input_needed');
    expect(listed.find((item) => item.key === 'C-2')?.attention?.kind).toBe('gate_failed');
  });

  it('orders attention-first across lifecycle boundaries (FR-008)', async () => {
    const listed = await items();
    const flagged = listed.map((item) => item.attention !== null);
    const firstUnflagged = flagged.indexOf(false);
    // No flagged item may appear after an unflagged one, whichever lifecycle it
    // came from — the list is one list, not two concatenated.
    expect(flagged.slice(firstUnflagged).every((value) => value === false)).toBe(true);
  });

  it('filters by SDLC without either lifecycle knowing about the other (FR-004)', async () => {
    const onlyCases = await services!.handlers.items.listItems({ packageId: 'casework' });
    expect(onlyCases.map((item) => item.key).sort()).toEqual(['C-1', 'C-2']);
  });

  it('filters by state using one lifecycle vocabulary only', async () => {
    const lodged = await services!.handlers.items.listItems({ stateId: 'lodged' });
    expect(lodged.map((item) => item.key)).toEqual(['C-1']);
  });

  it('searches across both lifecycles by identifier or title (FR-004)', async () => {
    const byTitle = await services!.handlers.items.listItems({ search: 'matter' });
    expect(byTitle.map((item) => item.key).sort()).toEqual(['C-1', 'C-2']);

    const byKey = await services!.handlers.items.listItems({ search: 'P-2' });
    expect(byKey.map((item) => item.key)).toEqual(['P-2']);
  });
});

describe('adopting the second lifecycle required no application change (SC-003)', () => {
  it('renders states whose ids appear nowhere in the application source', async () => {
    // The casework lifecycle was written for this test. If the engine had to
    // know its state names, they would have to exist in `src/`.
    const { readdir, readFile } = await import('node:fs/promises');
    const root = join(import.meta.dirname, '..', '..', 'src');

    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const offending: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      const contents = await readFile(join(entry.parentPath ?? root, entry.name), 'utf8');
      if (/\blodged\b/i.test(contents)) offending.push(entry.name);
    }
    expect(offending).toEqual([]);
  });
});

// ── 004: bounding the active list ────────────────────────────────────────────

/**
 * T007 — who decides that work is finished (FR-008, FR-015, FR-016).
 *
 * `terminal` is asserted through `listItems` rather than against `isTerminal`,
 * because the claim contracts/finished-work.md §1 makes is about what crosses the
 * IPC boundary: the main process answers the question once, and the renderer is
 * *told*. A unit test of the helper would pass even if `toSummary` never called
 * it.
 *
 * The two lifecycles are doing real work here too. `settled` and `closed` share
 * no id and no raw value, and neither appears in the application, so an engine
 * that had learned the word "closed" would get one of them wrong.
 *
 * The last two cases are the ones with teeth. Both describe a repository that
 * *cannot answer*, and in both the required answer is `false` — not because
 * `false` is a safe default but because it is the answer under which nothing
 * disappears. Each therefore asserts the item is still listed before asserting
 * what it says, since a test that only checked the flag would pass just as
 * happily if the work had vanished.
 */
describe('whether an item is finished is read from its own lifecycle (FR-008)', () => {
  const everything = () => services!.handlers.items.listItems({ includeTerminal: true });

  it('reports an item resting in a declared-terminal state as terminal', async () => {
    const listed = await everything();

    // Each item's own manifest declared its own state terminal; nothing else
    // distinguishes `delta` from `three`.
    expect(listedAs(listed, 'P-3').terminal).toBe(true);
    expect(listedAs(listed, 'P-3').stateName).toBe('Settled');
    expect(listedAs(listed, 'C-3').terminal).toBe(true);
    expect(listedAs(listed, 'C-3').stateName).toBe('Closed');
  });

  it('reports an item resting anywhere else as not terminal', async () => {
    const listed = await everything();

    // Including the last non-terminal state of each lifecycle: finishedness is
    // declared, never inferred from ordinal or from being near the end.
    expect(listedAs(listed, 'P-1').terminal).toBe(false);
    expect(listedAs(listed, 'P-2').terminal).toBe(false);
    expect(listedAs(listed, 'C-1').terminal).toBe(false);
    expect(listedAs(listed, 'C-2').terminal).toBe(false);
  });

  it('never calls an unmapped item finished, and keeps it in the active list (FR-015)', async () => {
    await republishParcelLifecycle(PARCELS_WITHOUT_INTAKE);

    // The default listing, deliberately: an unmapped item must be reachable
    // without anyone having asked to see finished work.
    const listed = await items();
    const orphan = listedAs(listed, 'P-1');

    // No declared state to consult any more — the ledger still says `alpha`.
    expect(orphan.stateName).toBeNull();
    expect(orphan.rawState).toBe('alpha');
    expect(orphan.terminal).toBe(false);
  });

  it('never calls an item finished when its repository lost its definition, and keeps it listed (FR-016)', async () => {
    await republishParcelLifecycle(PARCELS_UNREADABLE);

    const listed = await items();

    // P-3 was terminal one reconciliation ago and is now visible again. That is
    // the requirement, not a leak: nothing is knowable about this repository's
    // items, and the answer that hides work is the wrong guess.
    expect(keysOf(listed)).toContain('P-3');
    for (const key of ['P-1', 'P-2', 'P-3']) {
      expect(listedAs(listed, key).terminal).toBe(false);
    }

    // The other repository still has its definition and still answers for itself.
    expect(keysOf(listed)).not.toContain('C-3');
  });
});

/**
 * T009 — what the list withholds, and how it is asked to stop (FR-001, FR-006).
 *
 * `includeTerminal` exists because the original escape from the terminal rule —
 * naming the state — was unreachable from an interface: the list asks with no
 * filter, so a finished item never arrived, and the state choices are built from
 * the items that did. That escape is *retained* rather than replaced, so it gets
 * a test of its own below; a later reading of `matches()` that finds it redundant
 * should have to delete an assertion to remove it.
 *
 * The inclusive case asserts that active and finished work arrive **together**.
 * A count would pass against a filter that had swapped one list for the other,
 * which is precisely the shape this feature must not take: finished work is more
 * of the same list, not a second one.
 */
describe('finished work is withheld until it is asked for (FR-001)', () => {
  const depotId = async (): Promise<string> => {
    const repositories = await services!.handlers.repositories.listRepositories();
    const depot = repositories.find((repository) => repository.name === 'depot');
    if (depot === undefined) throw new Error('the depot repository was not registered');
    return depot.id;
  };

  it('excludes finished work when the filter says nothing about it', async () => {
    expect(keysOf(await items())).toEqual(['C-1', 'C-2', 'P-1', 'P-2']);
  });

  it('excludes finished work when inclusion is declined explicitly', async () => {
    // `false` and absent must not diverge: absent is the default, and a caller
    // that spells the default out gets the same list.
    const listed = await services!.handlers.items.listItems({ includeTerminal: false });
    expect(keysOf(listed)).toEqual(['C-1', 'C-2', 'P-1', 'P-2']);
  });

  it('returns finished work alongside active work, not instead of it', async () => {
    const listed = await services!.handlers.items.listItems({ includeTerminal: true });
    expect(keysOf(listed)).toEqual(['C-1', 'C-2', 'C-3', 'P-1', 'P-2', 'P-3']);
  });

  it('still returns terminal items when their state is named, unasked (retained escape)', async () => {
    // No `includeTerminal` anywhere here. Naming the state has always returned
    // items resting in it, whatever the lifecycle says about that state.
    const settled = await services!.handlers.items.listItems({ stateId: 'settled' });
    expect(keysOf(settled)).toEqual(['P-3']);
    expect(listedAs(settled, 'P-3').terminal).toBe(true);

    // And in the other lifecycle's vocabulary, which shares nothing with it.
    const closed = await services!.handlers.items.listItems({ stateId: 'closed' });
    expect(keysOf(closed)).toEqual(['C-3']);
  });

  it('narrows included finished work by repository exactly as it narrows active work (FR-006)', async () => {
    const listed = await services!.handlers.items.listItems({
      includeTerminal: true,
      repositoryId: await depotId(),
    });
    // One repository's finished item, and none of the other's.
    expect(keysOf(listed)).toEqual(['P-1', 'P-2', 'P-3']);
  });

  it('narrows included finished work by search exactly as it narrows active work (FR-006)', async () => {
    const found = await services!.handlers.items.listItems({
      includeTerminal: true,
      search: 'delivered',
    });
    expect(keysOf(found)).toEqual(['P-3']);

    // The same search without the inclusion finds nothing: search widens what is
    // looked at, never what is withheld.
    const withheld = await services!.handlers.items.listItems({ search: 'delivered' });
    expect(keysOf(withheld)).toEqual([]);
  });
});
