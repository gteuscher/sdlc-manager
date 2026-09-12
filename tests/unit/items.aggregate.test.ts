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

function parcelSeed(): FakeSeed {
  return {
    items: [
      { key: 'P-1', title: 'First parcel', rawState: 'alpha', fields: { key: 'P-1' } },
      { key: 'P-2', title: 'Second parcel', rawState: 'beta', fields: { key: 'P-2' } },
    ],
  };
}

function caseSeed(): FakeSeed {
  return {
    items: [
      { key: 'C-1', title: 'First matter', rawState: 'one', fields: { key: 'C-1' } },
      { key: 'C-2', title: 'Second matter', rawState: 'two', fields: { key: 'C-2' }, gates: { minuted: 'failed' } },
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
