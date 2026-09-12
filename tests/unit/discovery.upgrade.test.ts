/**
 * T100 — an SDLC package upgraded while items are in flight (spec §Edge Cases,
 * FR-046, SC-013).
 *
 * Two directions, and they fail in opposite ways.
 *
 * **Adding a state** is SC-013: "Upgrading an SDLC package to a version declaring
 * an additional state causes that state to appear in the interface on next load,
 * with no change to the application." That is the whole claim of Principle II
 * reduced to one observation. It is asserted here by scanning the same directory
 * before and after `fixture upgrade --add-state`, comparing the two state lists,
 * and then checking that the added state's id appears nowhere under `src/` — the
 * machine-checkable form of "with no change to the application".
 *
 * **Removing a state** is FR-046: items whose recorded state has vanished are
 * "marked unmapped rather than dropped or reassigned". The dangerous direction is
 * reassignment, because it is the helpful one: an item whose state no longer
 * exists looks like it belongs in the neighbouring state, and quietly moving it
 * there would make the dashboard disagree with the system of record — which is
 * the one thing Principle VI forbids it to do. So the assertions here are that
 * the files on disk are untouched, byte for byte, and that the raw value they
 * still carry resolves to UNMAPPED rather than to anything adjacent.
 *
 * Everything is generated into the OS temp directory and removed afterwards.
 * Nothing is written inside the repository working tree, and nothing is read from
 * it except `src/`, for the SC-013 check.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDeclaredState, resolveState } from '@core/engine/resolveState';
import type { SdlcDefinition, SdlcPackage } from '@core/model/declared';
import { UNMAPPED, isUnmapped } from '@core/model/observed';
import { scanPackages } from '@main/discovery/scan';

const FIXTURE_SCRIPT = fileURLToPath(new URL('../../scripts/fixture.ts', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * A state id invented for this test and deliberately absent from the source tree,
 * so "the application did not change" can be checked rather than asserted.
 */
const ADDED_STATE = 'kerbside';

function runFixture(...args: readonly string[]): void {
  execFileSync(process.execPath, [FIXTURE_SCRIPT, ...args], { stdio: 'pipe' });
}

/** The one package a generated fixture repository carries. */
async function scanOne(repositoryDir: string): Promise<SdlcPackage> {
  const found = await scanPackages([repositoryDir]);
  const supported = found.filter((entry) => entry.definition !== null);
  if (supported.length !== 1 || supported[0] === undefined) {
    throw new Error(`expected exactly one package under ${repositoryDir}, found ${found.length}`);
  }
  return supported[0];
}

function definitionOf(pkg: SdlcPackage): SdlcDefinition {
  if (pkg.definition === null) throw new Error(`${pkg.id} carries no definition`);
  return pkg.definition;
}

function stateIds(pkg: SdlcPackage): string[] {
  return definitionOf(pkg).states.map((state) => state.id);
}

// ── Reading what the repository records, without hardcoding its layout ───────

interface StateLocator {
  /** Matches the relative posix path of a file recording one item's state. */
  readonly pattern: RegExp;
  readonly field: string;
}

/**
 * Where the state-owning provider says an item's raw state is recorded, read from
 * the manifest rather than assumed. A test that hardcoded `docs/items/*` would be
 * doing the thing Principle II forbids the application to do.
 */
function stateLocatorOf(definition: SdlcDefinition): StateLocator {
  const owner = definition.ownership.state;
  const decl = definition.providers.find((provider) => provider.id === owner);
  const state: unknown = decl?.settings['state'];
  if (typeof state !== 'object' || state === null) {
    throw new Error(`the ${owner} provider declares no state locator`);
  }
  const record = state as Record<string, unknown>;
  const template = record['path'];
  const field = record['field'];
  if (typeof template !== 'string' || typeof field !== 'string') {
    throw new Error(`the ${owner} provider's state locator is incomplete`);
  }
  const escaped = template
    .split(/\{item\.[A-Za-z0-9_]+\}/)
    .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return { pattern: new RegExp(`^${escaped}$`), field };
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath ?? root, entry.name);
    files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files.sort();
}

/** Every byte the repository holds outside the package and the generator's bookkeeping. */
async function snapshotItems(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  for (const relative of await filesUnder(root)) {
    if (relative.startsWith('sdlc/') || relative.startsWith('.sdlc-fixture/')) continue;
    snapshot.set(relative, await readFile(path.join(root, relative), 'utf8'));
  }
  return snapshot;
}

/** The raw state value each item currently records on disk, keyed by its file. */
async function recordedRawStates(
  root: string,
  definition: SdlcDefinition,
): Promise<Map<string, string>> {
  const locator = stateLocatorOf(definition);
  const recorded = new Map<string, string>();
  for (const relative of await filesUnder(root)) {
    if (!locator.pattern.test(relative)) continue;
    const parsed: unknown = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) continue;
    const value = (parsed as Record<string, unknown>)[locator.field];
    if (typeof value === 'string') recorded.set(relative, value);
  }
  return recorded;
}

/** Every file under `src/` that mentions a token. Used to check SC-013's "no change". */
async function sourceFilesMentioning(token: string): Promise<string[]> {
  const entries = await readdir(SRC_DIR, { recursive: true, withFileTypes: true });
  const hits: string[] = [];
  const needle = token.toLowerCase();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath ?? SRC_DIR, entry.name);
    const text = await readFile(absolute, 'utf8');
    if (text.toLowerCase().includes(needle)) hits.push(path.relative(SRC_DIR, absolute));
  }
  return hits;
}

// ── The two upgrades ─────────────────────────────────────────────────────────

let root: string;

let addedDir: string;
let beforeAdd: SdlcPackage;
let afterAdd: SdlcPackage;
let addedRawStatesBefore: Map<string, string>;

let removedDir: string;
let beforeRemove: SdlcPackage;
let afterRemove: SdlcPackage;
/** The state the upgrade removes, chosen at runtime from what items actually occupy. */
let removedState: string;
let itemsBeforeRemoval: Map<string, string>;
let itemsAfterRemoval: Map<string, string>;
let rawStatesBeforeRemoval: Map<string, string>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sdlc-upgrade-'));

  // ── Direction 1: a version declaring one additional state ──────────────────
  addedDir = path.join(root, 'added');
  runFixture('create', addedDir);
  beforeAdd = await scanOne(addedDir);
  addedRawStatesBefore = await recordedRawStates(addedDir, definitionOf(beforeAdd));
  runFixture('upgrade', addedDir, '--add-state', ADDED_STATE);
  afterAdd = await scanOne(addedDir);

  // ── Direction 2: a version that no longer declares a state items are in ────
  removedDir = path.join(root, 'removed');
  runFixture('create', removedDir);
  beforeRemove = await scanOne(removedDir);
  const owner = definitionOf(beforeRemove).ownership.state;
  rawStatesBeforeRemoval = await recordedRawStates(removedDir, definitionOf(beforeRemove));
  itemsBeforeRemoval = await snapshotItems(removedDir);

  // Pick a state that items actually occupy, rather than naming one: the
  // interesting case is only interesting because something is resting in it.
  const occupied = new Set(
    [...rawStatesBeforeRemoval.values()].map(
      (raw) => resolveState(definitionOf(beforeRemove), owner, raw).stateId,
    ),
  );
  const candidate = definitionOf(beforeRemove).states.find(
    (state) => !state.terminal && occupied.has(state.id),
  );
  if (candidate === undefined) throw new Error('the fixture has no occupied non-terminal state');
  removedState = candidate.id;

  runFixture('upgrade', removedDir, '--remove-state', removedState);
  afterRemove = await scanOne(removedDir);
  itemsAfterRemoval = await snapshotItems(removedDir);
}, 180_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// SC-013 — an added state appears, with no change to the application
// ═════════════════════════════════════════════════════════════════════════════

describe('a package upgraded to declare an additional state (SC-013)', () => {
  it('did not declare the state before the upgrade, so the comparison means something', () => {
    expect(stateIds(beforeAdd)).not.toContain(ADDED_STATE);
  });

  it('declares it after the upgrade, from the same scan of the same directory', () => {
    expect(stateIds(afterAdd)).toContain(ADDED_STATE);
  });

  it('adds exactly one state and keeps every other one, in the order they were in', () => {
    // An upgrade that reordered or dropped the rest would still "add a state"
    // while making every item's position wrong.
    const before = stateIds(beforeAdd);
    const after = stateIds(afterAdd);
    expect(after.filter((id) => id !== ADDED_STATE)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
  });

  it('numbers the states so the added one has a position in the lifecycle', () => {
    // FR-011 orders the state tabs from the definition. A state with no ordinal
    // would appear, but nowhere in particular.
    const ordinals = definitionOf(afterAdd).states.map((state) => state.ordinal);
    expect(ordinals).toEqual(ordinals.map((_value, index) => index));
  });

  it('gives the added state a raw value of its own, so nothing else resolves into it', () => {
    // Manifest rule 9: no raw value maps to two states. Without it the added state
    // would silently capture items that belong elsewhere.
    const owner = definitionOf(afterAdd).ownership.state;
    const claims = definitionOf(afterAdd).states.flatMap((state) => state.maps[owner] ?? []);
    expect(new Set(claims).size).toBe(claims.length);
    const added = definitionOf(afterAdd).states.find((state) => state.id === ADDED_STATE);
    expect((added?.maps[owner] ?? []).length).toBeGreaterThan(0);
  });

  it('records a different package version than before the upgrade (FR-043)', () => {
    // FR-043 surfaces the version a repository is associated with. If the version
    // did not move, an upgrade would be invisible in the repository view.
    expect(afterAdd.version).not.toBe(beforeAdd.version);
    expect(afterAdd.version).not.toBe('unknown');
    expect(afterAdd.contractVersion).toBe(beforeAdd.contractVersion);
  });

  it('loads cleanly, so the new state is declared rather than merely present', () => {
    expect(afterAdd.problem).toBeNull();
    expect(afterAdd.id).toBe(beforeAdd.id);
  });

  it('leaves every item resolving to the state it was already in', () => {
    // Adding a state must not move anybody. An item only changes state when its
    // system of record says so (Principle V).
    const ownerBefore = definitionOf(beforeAdd).ownership.state;
    const ownerAfter = definitionOf(afterAdd).ownership.state;
    expect(addedRawStatesBefore.size).toBeGreaterThan(0);
    for (const [file, raw] of addedRawStatesBefore) {
      const before = resolveState(definitionOf(beforeAdd), ownerBefore, raw).stateId;
      const after = resolveState(definitionOf(afterAdd), ownerAfter, raw).stateId;
      expect(`${file}: ${after}`).toBe(`${file}: ${before}`);
    }
  });

  it('has no item resting in the added state yet', () => {
    const owner = definitionOf(afterAdd).ownership.state;
    const occupied = [...addedRawStatesBefore.values()].map(
      (raw) => resolveState(definitionOf(afterAdd), owner, raw).stateId,
    );
    expect(occupied).not.toContain(ADDED_STATE);
  });

  it('required no change to the application: the state id appears nowhere in src/', async () => {
    // This is SC-013's second half made checkable. If rendering this state had
    // needed a code change, the name would have had to be written down somewhere
    // in the source tree — and it is not.
    expect(await sourceFilesMentioning(ADDED_STATE)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-046 — a removed state leaves its items unmapped, never moved
// ═════════════════════════════════════════════════════════════════════════════

describe('a package upgraded to stop declaring a state items are in (FR-046)', () => {
  it('declared the state, and items were resting in it, before the upgrade', () => {
    // Without this the rest of the section could pass against an empty state.
    expect(stateIds(beforeRemove)).toContain(removedState);
    const owner = definitionOf(beforeRemove).ownership.state;
    const occupants = [...rawStatesBeforeRemoval.values()].filter(
      (raw) => resolveState(definitionOf(beforeRemove), owner, raw).stateId === removedState,
    );
    expect(occupants.length).toBeGreaterThan(0);
  });

  it('no longer declares it after the upgrade', () => {
    expect(stateIds(afterRemove)).not.toContain(removedState);
    expect(afterRemove.problem).toBeNull();
  });

  it('reports the vanished state as undeclared through isDeclaredState', () => {
    // This is the check that turns a stored state id into an unmapped row rather
    // than a lookup that quietly returns nothing.
    expect(isDeclaredState(definitionOf(beforeRemove), removedState)).toBe(true);
    expect(isDeclaredState(definitionOf(afterRemove), removedState)).toBe(false);
  });

  it('leaves every file in the repository untouched, byte for byte', () => {
    // FR-046 is a statement about the dashboard, and the dashboard is read-only
    // (FR-034, SC-011). An upgrade that "migrated" items would be writing to
    // someone's system of record on the strength of a version bump.
    expect([...itemsAfterRemoval.keys()]).toEqual([...itemsBeforeRemoval.keys()]);
    for (const [file, contents] of itemsBeforeRemoval) {
      expect(`${file}: ${itemsAfterRemoval.get(file)}`).toBe(`${file}: ${contents}`);
    }
  });

  it('still records the same raw value for the items that were in the removed state', () => {
    const owner = definitionOf(beforeRemove).ownership.state;
    const stranded = [...rawStatesBeforeRemoval.entries()].filter(
      ([, raw]) => resolveState(definitionOf(beforeRemove), owner, raw).stateId === removedState,
    );
    expect(stranded.length).toBeGreaterThan(0);
    for (const [file, raw] of stranded) {
      const after = JSON.parse(itemsAfterRemoval.get(file) ?? 'null') as Record<string, unknown>;
      expect(after[stateLocatorOf(definitionOf(afterRemove)).field]).toBe(raw);
    }
  });

  it('resolves those items to UNMAPPED, retaining the raw value (FR-005, FR-046)', () => {
    const owner = definitionOf(afterRemove).ownership.state;
    const previousOwner = definitionOf(beforeRemove).ownership.state;
    const stranded = [...rawStatesBeforeRemoval.values()].filter(
      (raw) => resolveState(definitionOf(beforeRemove), previousOwner, raw).stateId === removedState,
    );

    for (const raw of stranded) {
      const resolution = resolveState(definitionOf(afterRemove), owner, raw);
      expect(isUnmapped(resolution.stateId)).toBe(true);
      expect(resolution.stateId).toBe(UNMAPPED);
      // Retained, so the row can show what the system of record actually says.
      expect(resolution.rawState).toBe(raw);
    }
  });

  it('does not reassign them to the state on either side of the one removed', () => {
    // The tempting repair. An item in a state the lifecycle no longer has is a
    // fact about the upgrade, and moving it to a neighbour would hide the fact
    // while making the dashboard disagree with the repository.
    const before = stateIds(beforeRemove);
    const index = before.indexOf(removedState);
    const neighbours = [before[index - 1], before[index + 1]].filter(
      (id): id is string => id !== undefined,
    );
    expect(neighbours.length).toBeGreaterThan(0);

    const owner = definitionOf(afterRemove).ownership.state;
    const previousOwner = definitionOf(beforeRemove).ownership.state;
    for (const raw of rawStatesBeforeRemoval.values()) {
      if (resolveState(definitionOf(beforeRemove), previousOwner, raw).stateId !== removedState) {
        continue;
      }
      expect(neighbours).not.toContain(resolveState(definitionOf(afterRemove), owner, raw).stateId);
    }
  });

  it('does not drop them: the files the discovery rule finds are all still there', () => {
    // "Neither dropped nor reassigned" — this is the dropped half. The item still
    // exists in the system of record, so it must still be listed.
    const locator = stateLocatorOf(definitionOf(afterRemove));
    const recordsBefore = [...itemsBeforeRemoval.keys()].filter((file) => locator.pattern.test(file));
    const recordsAfter = [...itemsAfterRemoval.keys()].filter((file) => locator.pattern.test(file));
    expect(recordsBefore.length).toBeGreaterThan(0);
    expect(recordsAfter).toEqual(recordsBefore);
  });

  it('leaves every item whose state survived resolving exactly as before', () => {
    // The blast radius of a removal is the items in the removed state and nobody
    // else.
    const owner = definitionOf(afterRemove).ownership.state;
    const previousOwner = definitionOf(beforeRemove).ownership.state;
    let compared = 0;
    for (const [file, raw] of rawStatesBeforeRemoval) {
      const before = resolveState(definitionOf(beforeRemove), previousOwner, raw).stateId;
      if (before === removedState) continue;
      compared += 1;
      expect(`${file}: ${resolveState(definitionOf(afterRemove), owner, raw).stateId}`).toBe(
        `${file}: ${before}`,
      );
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('records a different package version, because a removal is breaking for items in flight', () => {
    expect(afterRemove.version).not.toBe(beforeRemove.version);
    expect(afterRemove.version).not.toBe('unknown');
  });

  it('leaves the manifest internally consistent: nothing still requires a gate that left with the state', () => {
    // FR-044 refuses to load a partially valid manifest, so a dangling transition
    // would have surfaced as `definition: null` instead of an upgraded lifecycle.
    const definition = definitionOf(afterRemove);
    const declaredStates = new Set(definition.states.map((state) => state.id));
    const declaredGates = new Set(
      definition.states.flatMap((state) => state.gates.map((entry) => entry.id)),
    );
    for (const transition of definition.transitions) {
      expect(declaredStates.has(transition.from)).toBe(true);
      expect(declaredStates.has(transition.to)).toBe(true);
      for (const required of transition.requires) {
        expect(declaredGates.has(required)).toBe(true);
      }
    }
  });
});
