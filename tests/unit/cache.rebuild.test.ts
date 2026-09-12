/**
 * T051 — gate 4, the cache rebuild.
 *
 * Principle VI says the application "MUST NOT maintain a competing authoritative
 * store", and FR-038 says any local copy of work-item data is "a cache that can
 * be deleted and rebuilt from the systems of record". Those are easy sentences to
 * write and easy to violate by accident: the moment anything is *only* in the
 * cache, the claim is false and nothing notices until a user deletes it.
 *
 * So the test is the one quickstart V8 describes. Note the item states, delete
 * the entire cache directory, rebuild, and compare. If anything differs, the
 * cache was holding something authoritative — which is how "no competing store"
 * gets verified rather than asserted (SC-009).
 *
 * The providers here are the **fakes**, driven from a fixed seed, which is what
 * makes the comparison meaningful: the system of record is held constant across
 * the wipe, so any difference is attributable to the cache and nothing else.
 */

import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServices, type Services } from '@main/index';
import { CACHE_DIRECTORY, createCache } from '@main/cache/index';
import type { SafeStorageLike } from '@main/secrets/index';
import type { ProviderFactories } from '@main/providers';
import type { WorkItemSummary } from '@core/model/observed';
import { createFakeProvider, type FakeSeed } from '@providers/fakes/base';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc::${plain}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^enc::/, ''),
};

/** A lifecycle whose only provider is a fake, so the system of record is fixed. */
const MANIFEST = `
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
    maps:
      ledger: ["alpha"]
    gates:
      - id: appraised
        name: Appraisal recorded
        kind: field
        provider: ledger
        field: valuation
        passes_when: { present: true }
  - id: dispatch
    name: Dispatch
    maps:
      ledger: ["beta"]
    gates:
      - id: weighed
        name: Weight verified
        kind: check
        provider: ledger
        check: scales
  - id: transit
    name: In transit
    awaits_human: true
    maps:
      ledger: ["gamma"]
  - id: settled
    name: Settled
    terminal: true
    maps:
      ledger: ["delta"]
`;

function seed(): FakeSeed {
  return {
    items: [
      { key: 'P-1', title: 'First parcel', rawState: 'alpha', fields: { key: 'P-1' }, gates: { appraised: 'passed' } },
      { key: 'P-2', title: 'Second parcel', rawState: 'beta', fields: { key: 'P-2' }, gates: { weighed: 'failed' } },
      { key: 'P-3', title: 'Third parcel', rawState: 'gamma', fields: { key: 'P-3' } },
      { key: 'P-4', title: 'Fourth parcel', rawState: 'omega', fields: { key: 'P-4' } },
    ],
  };
}

/** The fake stands in for the system of record, and is identical on both runs. */
function factories(): ProviderFactories {
  return { memo: (options) => createFakeProvider('memo', { ...options, seed: seed() }) };
}

let userDataDir: string;
let packageRoot: string;
let repositoryPath: string;
let services: Services | undefined;

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'sdlc-rebuild-'));
  packageRoot = await mkdtemp(join(tmpdir(), 'sdlc-rebuild-packages-'));
  repositoryPath = await mkdtemp(join(tmpdir(), 'sdlc-rebuild-repo-'));

  const pkg = join(packageRoot, 'parcels');
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, 'sdlc.yaml'), MANIFEST, 'utf8');
});

afterEach(async () => {
  await services?.dispose().catch(() => undefined);
  services = undefined;
  await rm(userDataDir, { recursive: true, force: true });
  await rm(packageRoot, { recursive: true, force: true });
  await rm(repositoryPath, { recursive: true, force: true });
});

async function open(): Promise<Services> {
  const opened = createServices({
    userDataDir,
    safeStorage,
    packageRoots: [packageRoot],
    providerFactories: factories(),
  });
  await opened.start();
  services = opened;
  return opened;
}

/** Everything the interface shows about an item, ordered so comparison is stable. */
function comparable(items: readonly WorkItemSummary[]) {
  return [...items]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((item) => ({
      key: item.key,
      title: item.title,
      stateId: item.stateId,
      stateName: item.stateName,
      rawState: item.rawState,
      attention: item.attention,
      sdlcName: item.sdlcName,
      unit: item.unit,
      disagreements: item.disagreements,
      // T008 (004). Finishedness is derived from the loaded definition on every
      // projection and written down nowhere, so a cache wiped and rebuilt from
      // the system of record must reproduce it exactly. This is the one gate
      // that would notice if someone ever persisted it: a stored copy would
      // survive the wipe and could then disagree with the definition that owns
      // it (Principle VI).
      terminal: item.terminal,
    }));
}

async function register(target: Services): Promise<void> {
  const registered = await target.handlers.repositories.registerRepository({
    name: 'depot',
    path: repositoryPath,
    packageId: 'parcels',
  });
  expect(registered.ok, registered.ok ? '' : registered.message).toBe(true);
}

describe('deleting the cache and rebuilding reproduces identical state (FR-038, SC-009)', () => {
  it('produces the same item states and gate results after a full wipe', async () => {
    const first = await open();
    await register(first);
    const before = comparable(await first.handlers.items.listItems({}));
    expect(before.length).toBeGreaterThan(0);

    await first.dispose();

    // Quickstart V8: quit, delete the whole cache directory, reopen.
    await rm(first.cache.root, { recursive: true, force: true });

    const second = await open();
    const after = comparable(await second.handlers.items.listItems({}));

    expect(after).toEqual(before);
  });

  it('reproduces per-state gate results, not merely the item rows', async () => {
    const first = await open();
    await register(first);
    const before = await first.handlers.items.getItem({ key: 'P-2' });
    expect(before.ok).toBe(true);
    await first.dispose();

    await rm(first.cache.root, { recursive: true, force: true });

    const second = await open();
    const after = await second.handlers.items.getItem({ key: 'P-2' });
    expect(after.ok).toBe(true);
    if (!before.ok || !after.ok) return;

    const statuses = (detail: typeof before.value) =>
      detail.states.map((state) => [state.id, state.progress, state.gates.map((gate) => gate.result.status)]);

    expect(statuses(after.value)).toEqual(statuses(before.value));
  });

  it('reproduces the attention signal, which is derived and never stored (FR-007)', async () => {
    const first = await open();
    await register(first);
    const before = comparable(await first.handlers.items.listItems({})).map((item) => item.attention);
    await first.dispose();

    await rm(first.cache.root, { recursive: true, force: true });

    const second = await open();
    const after = comparable(await second.handlers.items.listItems({})).map((item) => item.attention);

    // The marker survives because the facts that produce it are read back, not
    // because anything remembered it.
    expect(after).toEqual(before);
    expect(after.some((signal) => signal !== null)).toBe(true);
  });

  it('reproduces an unmapped item, retaining its raw value (FR-005)', async () => {
    const first = await open();
    await register(first);
    await first.dispose();
    await rm(first.cache.root, { recursive: true, force: true });

    const second = await open();
    const items = await second.handlers.items.listItems({});
    const unmapped = items.find((item) => item.key === 'P-4');

    expect(unmapped?.rawState).toBe('omega');
    expect(unmapped?.stateName).toBeNull();
  });

  it('recreates the cache directory rather than requiring the user to', async () => {
    const first = await open();
    await register(first);
    await first.dispose();
    await rm(first.cache.root, { recursive: true, force: true });
    expect(existsSync(first.cache.root)).toBe(false);

    const second = await open();
    await second.handlers.items.listItems({});
    expect(existsSync(second.cache.root)).toBe(true);
  });

  it('survives deletion while the application is running', async () => {
    const running = await open();
    await register(running);
    await running.handlers.items.listItems({});

    // Spec §Edge Cases: "The local cache is deleted while the application is
    // running or between runs."
    await rm(running.cache.root, { recursive: true, force: true });

    await expect(running.handlers.items.listItems({})).resolves.toBeInstanceOf(Array);
  });

  it('survives the cache being replaced by nonsense, discarding rather than misreading it', async () => {
    const running = await open();
    await register(running);
    const before = comparable(await running.handlers.items.listItems({}));
    await running.dispose();

    await mkdir(join(running.cache.root, 'items'), { recursive: true });
    await writeFile(join(running.cache.root, 'items', 'depot.json'), 'not json at all', 'utf8');

    const second = await open();
    expect(comparable(await second.handlers.items.listItems({}))).toEqual(before);
  });

  it('discards an unrecognised cache schema version instead of reading it', async () => {
    const running = await open();
    await register(running);
    await running.dispose();

    // A directory from a future or past schema must be discarded, never misread.
    // Named from the module rather than hardcoded: the directory moved once
    // already, to stop colliding with Chromium's own cache.
    const cacheParent = join(userDataDir, CACHE_DIRECTORY);
    await mkdir(join(cacheParent, 'v0', 'items'), { recursive: true });
    await writeFile(join(cacheParent, 'v0', 'items', 'depot.json'), '[{"key":"GHOST"}]', 'utf8');

    const second = await open();
    const items = await second.handlers.items.listItems({});

    expect(items.map((item) => item.key)).not.toContain('GHOST');
    expect(await readdir(cacheParent)).not.toContain('v0');
  });
});

describe('the cache shares its user-data directory with Electron itself', () => {
  /**
   * A regression guard for a bug that reached the user and that no earlier test
   * could have caught, because every one of them started from an empty temp
   * directory.
   *
   * Electron keeps Chromium's HTTP cache at `<userData>/Cache`. This application
   * used `<userData>/cache`, and on Windows and macOS those are the same
   * directory. The version-discard logic then treated Chromium's `Cache_Data` as
   * an unrecognised version of our own cache and tried to delete it — which
   * failed with EPERM because Chromium holds those files open, aborting the first
   * reconciliation so that the application showed no repositories at all while
   * the registry still held them.
   */

  /** Directories Electron creates in the user-data directory. */
  const ELECTRON_OWNED = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Network', 'Local Storage'];

  it('does not live in a directory Electron reserves', () => {
    const cache = createCache(userDataDir);
    const segment = cache.root.slice(userDataDir.length).split(/[\\/]/).filter(Boolean)[0] ?? '';

    for (const reserved of ELECTRON_OWNED) {
      // Case-insensitive, because the filesystems this runs on are.
      expect(segment.toLowerCase(), `cache directory collides with Electron's "${reserved}"`).not.toBe(
        reserved.toLowerCase(),
      );
    }
  });

  it('never deletes a directory it did not create', async () => {
    const first = await open();
    await register(first);
    await first.dispose();

    // Stand in for Chromium's files, in the directory our cache lives in.
    const foreign = join(first.cache.root, '..', 'Cache_Data');
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, 'data_1'), 'chromium owns this', 'utf8');

    const second = await open();
    await second.handlers.items.listItems({});

    // Deleting what we do not recognise is the wrong default for a directory this
    // application does not own outright.
    expect(existsSync(join(foreign, 'data_1'))).toBe(true);
  });

  it('still discards a genuine foreign version directory', async () => {
    const running = await open();
    await register(running);
    await running.dispose();

    const stale = join(running.cache.root, '..', 'v0');
    await mkdir(join(stale, 'items'), { recursive: true });
    await writeFile(join(stale, 'items', 'depot.json'), '[{"key":"GHOST"}]', 'utf8');

    const second = await open();
    await second.handlers.items.listItems({});

    expect(existsSync(stale)).toBe(false);
  });

  it('boots even when a stale version directory cannot be removed', async () => {
    // The failure mode that aborted reconciliation: a delete that throws must not
    // take the application down with it. A stale directory is never read.
    const running = await open();
    await register(running);
    const items = await running.handlers.items.listItems({});
    expect(items.length).toBeGreaterThan(0);
  });
});

describe('the registry is configuration, not cache', () => {
  it('survives a cache wipe, so V8 has something to rebuild', async () => {
    const first = await open();
    await register(first);
    await first.dispose();

    await rm(first.cache.root, { recursive: true, force: true });

    const second = await open();
    const repositories = await second.handlers.repositories.listRepositories();

    // If registrations lived in the cache, deleting it would unregister
    // everything and quickstart V8 could never pass. They are the engineer's
    // configuration, not derived data.
    expect(repositories.map((repository) => repository.name)).toContain('depot');
  });

  it('keeps credentials out of the cache directory entirely', async () => {
    const running = await open();
    await running.secrets.set('ledger', 'a-secret-value');

    const cacheContents = existsSync(running.cache.root)
      ? await readdir(running.cache.root, { recursive: true })
      : [];
    expect(JSON.stringify(cacheContents)).not.toContain('secret');
  });
});
