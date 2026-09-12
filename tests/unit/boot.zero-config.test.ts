/**
 * T050 — gate 3, the zero-config boot.
 *
 * Principle I is non-negotiable about this: "The application MUST start with zero
 * third-party credentials configured. Where a loaded workflow depends on a
 * provider the user has not configured, the application MUST present an
 * actionable configuration prompt naming the missing provider — **never a crash,
 * a blank screen, or a silent empty state**."
 *
 * Those three named failures are what this file tests for, in that order. The
 * third is the sly one: a build that catches every error and renders nothing
 * passes a "does it crash" test while failing the requirement completely. So the
 * assertions below check not only that reads succeed, but that what comes back
 * *names* what is missing.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServices, type Services } from '@main/index';
import type { SafeStorageLike } from '@main/secrets/index';

let userDataDir: string;
let packageRoot: string;
let services: Services;

/** Stands in for Electron's safeStorage. Never reached in these tests. */
const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc::${plain}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^enc::/, ''),
};

/** A lifecycle whose only provider needs a credential this machine does not have. */
const MANIFEST_NEEDING_A_CREDENTIAL = `
sdlc: 1
id: remote-only
name: Remote Only Lifecycle
version: 1.0.0
providers:
  - id: ledger
    kind: jira
    base_url: https://example.invalid
    email: nobody@example.invalid
ownership:
  state: ledger
  title: ledger
  artifacts: ledger
items:
  unit: parcel
  discover:
    - provider: ledger
      query: assignee = currentUser()
  identity:
    correlate_on: key
states:
  - id: intake
    name: Intake
    maps:
      ledger: ["alpha"]
  - id: settled
    name: Settled
    terminal: true
`;

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'sdlc-boot-'));
  packageRoot = await mkdtemp(join(tmpdir(), 'sdlc-boot-packages-'));
});

afterEach(async () => {
  await services?.dispose().catch(() => undefined);
  await rm(userDataDir, { recursive: true, force: true });
  await rm(packageRoot, { recursive: true, force: true });
});

function boot(): Services {
  services = createServices({
    userDataDir,
    safeStorage,
    packageRoots: [packageRoot],
    // No credential is ever set in this file. That is the point.
    fetch: () => Promise.reject(new Error('no network in tests')),
  });
  return services;
}

describe('booting with nothing configured at all', () => {
  it('constructs the whole service graph without throwing', () => {
    expect(() => boot()).not.toThrow();
  });

  it('starts with no repositories registered and no packages installed', async () => {
    const started = boot();
    await started.start();

    expect(await started.handlers.repositories.listRepositories()).toEqual([]);
    expect(await started.handlers.repositories.listPackages()).toEqual([]);
  });

  it('serves an empty item list rather than failing', async () => {
    const started = boot();
    await started.start();
    await expect(started.handlers.items.listItems({})).resolves.toEqual([]);
  });

  it('answers a request for an item that does not exist with a typed failure, not a rejection', async () => {
    const started = boot();
    await started.start();

    // Failures are values (ipc-surface.md rule 5): a rejected promise carrying a
    // stack cannot be rendered as an in-place error with a retry.
    const result = await started.handlers.items.getItem({ key: 'nothing' });
    expect(result.ok).toBe(false);
  });

  it('writes no credential anywhere, because none was supplied', async () => {
    const started = boot();
    await started.start();
    expect(await started.secrets.listConfigured()).toEqual([]);
  });

  it('starts twice over the same user-data directory, as a reopen would', async () => {
    const first = boot();
    await first.start();
    await first.dispose();

    services = createServices({ userDataDir, safeStorage, packageRoots: [packageRoot] });
    await expect(services.start()).resolves.toBeUndefined();
  });
});

describe('a workflow declaring an unconfigured provider (FR-035, SC-006)', () => {
  beforeEach(async () => {
    const pkg = join(packageRoot, 'remote-only');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'sdlc.yaml'), MANIFEST_NEEDING_A_CREDENTIAL, 'utf8');
  });

  it('still loads the package, rather than refusing to start', async () => {
    const started = boot();
    await started.start();

    const packages = await started.handlers.repositories.listPackages();
    expect(packages.map((entry) => entry.id)).toContain('remote-only');
  });

  it('reports the package as supported — the lifecycle is fine, the credential is missing', async () => {
    const started = boot();
    await started.start();

    const [pkg] = await started.handlers.repositories.listPackages();
    // An unconfigured provider is not a malformed manifest, and conflating the
    // two would tell the engineer to fix the wrong thing.
    expect(pkg?.supported).toBe(true);
    expect(pkg?.problem).toBeNull();
  });

  it('names the provider kind the lifecycle needs, so the prompt can be actionable', async () => {
    const started = boot();
    await started.start();

    const [pkg] = await started.handlers.repositories.listPackages();
    expect(pkg?.providerKinds.length).toBeGreaterThan(0);
  });

  it('registers a repository against it without requiring a credential first', async () => {
    const started = boot();
    await started.start();

    const registered = await started.handlers.repositories.registerRepository({
      name: 'depot',
      path: userDataDir,
      packageId: 'remote-only',
    });

    // Demanding configuration before the application will accept a repository is
    // exactly the "prompts for credentials before showing anything" failure.
    expect(registered.ok).toBe(true);
  });

  it('reports which provider is unconfigured, by name, on the registered repository (FR-026)', async () => {
    const started = boot();
    await started.start();
    await started.handlers.repositories.registerRepository({
      name: 'depot',
      path: userDataDir,
      packageId: 'remote-only',
    });

    const [repository] = await started.handlers.repositories.listRepositories();
    const statuses = Object.values(repository?.providerStatus ?? {});

    expect(statuses.length).toBeGreaterThan(0);
    const unconfigured = statuses.filter((status) => status.status === 'not_configured');
    expect(unconfigured.length).toBeGreaterThan(0);
    // Actionable means it says which provider, not merely that something is wrong.
    expect(unconfigured[0]?.message).toContain(unconfigured[0]?.providerId ?? '');
    expect((unconfigured[0]?.message ?? '').length).toBeGreaterThan(20);
  });

  it('keeps the item list readable rather than blank-screening on the failing provider', async () => {
    const started = boot();
    await started.start();
    await started.handlers.repositories.registerRepository({
      name: 'depot',
      path: userDataDir,
      packageId: 'remote-only',
    });

    // No credential, so the provider can return nothing. The list must still be
    // a list — an empty one the interface can put copy around, not an exception.
    await expect(started.handlers.items.listItems({})).resolves.toBeInstanceOf(Array);
  });

  it('never throws from any read path while unconfigured', async () => {
    const started = boot();
    await started.start();
    await started.handlers.repositories.registerRepository({
      name: 'depot',
      path: userDataDir,
      packageId: 'remote-only',
    });

    await expect(
      Promise.all([
        started.handlers.repositories.listPackages(),
        started.handlers.repositories.listRepositories(),
        started.handlers.items.listItems({}),
        started.handlers.items.getItem({ key: 'ALPHA-1' }),
        started.handlers.console.getConversation({ key: 'ALPHA-1', stateId: 'intake' }),
      ]),
    ).resolves.toBeDefined();
  });
});

describe('an unsupported package cannot be associated with a repository (FR-045)', () => {
  beforeEach(async () => {
    // An agent package that carries skill prose describing a lifecycle, and no
    // manifest. Principle II's hard line: a described state does not exist.
    const pkg = join(packageRoot, 'prose-only');
    await mkdir(join(pkg, 'skills'), { recursive: true });
    await writeFile(
      join(pkg, 'skills', 'SKILL.md'),
      '# Lifecycle\n\nWork moves through Draft, then Build, then Ship.\n',
      'utf8',
    );
    await writeFile(join(pkg, 'plugin.json'), JSON.stringify({ name: 'prose-only' }), 'utf8');
  });

  it('lists the package as unsupported, naming what is missing', async () => {
    const started = boot();
    await started.start();

    const [pkg] = await started.handlers.repositories.listPackages();
    expect(pkg?.supported).toBe(false);
    expect(pkg?.problem ?? '').toMatch(/sdlc\.yaml/);
  });

  it('refuses the association rather than accepting it and failing later', async () => {
    const started = boot();
    await started.start();

    const registered = await started.handlers.repositories.registerRepository({
      name: 'depot',
      path: userDataDir,
      packageId: 'prose-only',
    });

    expect(registered.ok).toBe(false);
    if (registered.ok) return;
    expect(registered.message).toMatch(/sdlc\.yaml|unsupported|manifest/i);
  });

  it('exposes no state from the prose, because a described state does not exist', async () => {
    const started = boot();
    await started.start();

    const [pkg] = await started.handlers.repositories.listPackages();
    expect(pkg?.stateCount).toBe(0);
    expect(JSON.stringify(pkg)).not.toMatch(/Draft|Build|Ship/);
  });
});
