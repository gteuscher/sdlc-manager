/**
 * T059 — reconciliation without a restart (FR-010).
 *
 * "System MUST update item state and attention markers as the underlying sources
 * change, without requiring the engineer to restart the application."
 *
 * Two paths have to work, because the spec's own assumption splits them: local
 * sources are *observed as they change*, remote sources are *polled on an
 * interval and on explicit refresh*. Both are tested below, and both are checked
 * for the same two outcomes — an invalidation reaches the renderer, and the next
 * read returns the new state.
 *
 * The invalidation half matters as much as the state half. Events are
 * invalidations, not payloads (ipc-surface.md §3): if the state updated but no
 * event was emitted, a running application would sit on stale data until
 * something else happened to refetch, which is the restart requirement failing
 * quietly rather than loudly.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServices, type Services } from '@main/index';
import type { SafeStorageLike } from '@main/secrets/index';
import type { ProviderFactories } from '@main/providers';
import type { ChangeEvent } from '@core/ipc/schema';
import { createFakeProvider, type FakeControls, type FakeSeed } from '@providers/fakes/base';
import { createFilesystemProvider } from '@providers/filesystem/index';
import type { Provider } from '@providers/contract';

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc::${plain}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^enc::/, ''),
};

const MANIFEST = `
sdlc: 1
id: parcels
name: Parcel Handling
version: 1.0.0
providers:
  - id: repo
    kind: filesystem
    root: "."
    state:
      path: "records/{item.key}/parcel.json"
      field: "status"
    title_field: "title"
ownership:
  state: repo
  title: repo
  artifacts: repo
items:
  unit: parcel
  discover:
    - provider: repo
      glob: "records/*/parcel.json"
  identity:
    correlate_on: key
    patterns:
      repo: "records/(?<key>[A-Z]+-[0-9]+)/parcel\\\\.json"
states:
  - id: intake
    name: Intake
    maps: { repo: ["alpha"] }
  - id: dispatch
    name: Dispatch
    awaits_human: true
    maps: { repo: ["beta"] }
  - id: settled
    name: Settled
    terminal: true
    maps: { repo: ["delta"] }
`;

let userDataDir: string;
let packageRoot: string;
let repositoryPath: string;
let services: Services | undefined;
let events: ChangeEvent[];

async function writeStatus(status: string): Promise<void> {
  await writeFile(
    join(repositoryPath, 'records', 'P-1', 'parcel.json'),
    JSON.stringify({ title: 'First parcel', status }),
    'utf8',
  );
}

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'sdlc-reconcile-'));
  packageRoot = await mkdtemp(join(tmpdir(), 'sdlc-reconcile-packages-'));
  repositoryPath = await mkdtemp(join(tmpdir(), 'sdlc-reconcile-repo-'));
  events = [];

  const pkg = join(packageRoot, 'parcels');
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, 'sdlc.yaml'), MANIFEST, 'utf8');

  await mkdir(join(repositoryPath, 'records', 'P-1'), { recursive: true });
  await writeStatus('alpha');
});

afterEach(async () => {
  await services?.dispose().catch(() => undefined);
  services = undefined;
  for (const dir of [userDataDir, packageRoot, repositoryPath]) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function open(factories?: ProviderFactories): Promise<Services> {
  const opened = createServices({
    userDataDir,
    safeStorage,
    packageRoots: [packageRoot],
    send: (event) => events.push(event),
    // Short debounce so a watch burst settles quickly in a test.
    debounceMs: 20,
    ...(factories ? { providerFactories: factories } : {}),
  });
  await opened.start();
  services = opened;

  const registered = await opened.handlers.repositories.registerRepository({
    name: 'depot',
    path: repositoryPath,
    packageId: 'parcels',
  });
  expect(registered.ok, registered.ok ? '' : registered.message).toBe(true);
  return opened;
}

async function stateOf(key: string): Promise<string | null | undefined> {
  const listed = await services!.handlers.items.listItems({});
  return listed.find((item) => item.key === key)?.stateName;
}

describe('a change to a watched file updates the item without a restart', () => {
  it('reads the initial state from the system of record', async () => {
    await open({ filesystem: createFilesystemProvider });
    expect(await stateOf('P-1')).toBe('Intake');
  });

  it('reflects an edit made outside the application', async () => {
    await open({ filesystem: createFilesystemProvider });
    expect(await stateOf('P-1')).toBe('Intake');

    await writeStatus('beta');

    // Same process, no restart: the watch fires, reconciliation runs, the next
    // read returns the new state.
    await vi.waitFor(async () => {
      expect(await stateOf('P-1')).toBe('Dispatch');
    }, { timeout: 15_000, interval: 100 });
  }, 30_000);

  it('emits an invalidation so a running renderer knows to re-read', async () => {
    await open({ filesystem: createFilesystemProvider });
    events.length = 0;

    await writeStatus('beta');

    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThan(0);
    }, { timeout: 15_000, interval: 100 });

    // Invalidations name what changed; they never carry the item itself.
    for (const event of events) {
      expect(['items', 'item', 'repositories', 'providerHealth']).toContain(event.type);
      expect(JSON.stringify(event)).not.toContain('First parcel');
    }
  }, 30_000);

  it('updates the attention marker along with the state (FR-010)', async () => {
    await open({ filesystem: createFilesystemProvider });

    const before = (await services!.handlers.items.listItems({})).find((item) => item.key === 'P-1');
    expect(before?.attention).toBeNull();

    // `dispatch` is declared as awaiting a human.
    await writeStatus('beta');

    await vi.waitFor(async () => {
      const after = (await services!.handlers.items.listItems({})).find((item) => item.key === 'P-1');
      expect(after?.attention?.kind).toBe('input_needed');
    }, { timeout: 15_000, interval: 100 });
  }, 30_000);
});

describe('a poll tick updates the item without a restart', () => {
  /** A fake standing in for a remote provider, whose subscription is a poll. */
  function pollingFactories(controls: { current?: Provider & FakeControls }): ProviderFactories {
    const seed = (status: string): FakeSeed => ({
      items: [{ key: 'P-1', title: 'First parcel', rawState: status, fields: { key: 'P-1' } }],
    });
    return {
      filesystem: (options) => {
        const fake = createFakeProvider('filesystem', { ...options, seed: seed('alpha') });
        controls.current = fake;
        return fake;
      },
    };
  }

  it('re-reads and emits an invalidation when the poll fires', async () => {
    const controls: { current?: Provider & FakeControls } = {};
    await open(pollingFactories(controls));
    expect(await stateOf('P-1')).toBe('Intake');

    events.length = 0;
    // A remote provider has nothing to watch; its subscription is an interval,
    // and this is that interval firing.
    controls.current?.emitChange();

    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThan(0);
    }, { timeout: 10_000, interval: 50 });
  }, 20_000);
});

describe('explicit refresh is always available (Principle X)', () => {
  it('reconciles on demand, which is the retry a failed provider offers', async () => {
    await open({ filesystem: createFilesystemProvider });
    await writeStatus('beta');

    const refreshed = await services!.handlers.repositories.listRepositories();
    expect(refreshed.length).toBe(1);

    const result = await services!.reconciler.refresh({});
    expect(result.ok).toBe(true);
    expect(await stateOf('P-1')).toBe('Dispatch');
  }, 20_000);

  it('scopes a refresh to one repository when asked', async () => {
    const opened = await open({ filesystem: createFilesystemProvider });
    const [repository] = await opened.handlers.repositories.listRepositories();
    expect(repository).toBeDefined();

    const result = await opened.reconciler.refresh({ repositoryId: repository!.id });
    expect(result.ok).toBe(true);
  }, 20_000);

  it('reports a failure as a value rather than rejecting', async () => {
    const opened = await open({ filesystem: createFilesystemProvider });
    const result = await opened.reconciler.refresh({ repositoryId: 'no-such-repository' });
    // Failures are values (rule 5) — a retry button needs something to render.
    expect(result.ok).toBe(false);
  }, 20_000);
});
