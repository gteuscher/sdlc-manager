/**
 * T099 — the two degenerate registrations spec.md names in §Edge Cases:
 *
 *   "A repository is registered twice, or registered at a path that no longer
 *    exists."
 *
 * Both are ordinary. A repository gets registered twice because the second
 * spelling looks different to a human — a drive letter in the other case, a
 * trailing backslash from a shell completion — and on Windows those are the same
 * directory. A registered path stops existing because a branch was cleaned up, a
 * network drive was not mounted, or a clone was moved.
 *
 * Neither may cost anything beyond itself. A duplicate must become one
 * registration and not two rows reconciling the same directory twice, and a
 * vanished path must report unavailable while every other registration keeps
 * working — the blast-radius rule of Principle III, applied to configuration
 * rather than to a provider.
 *
 * The third claim is FR-025's: an invalid configuration is rejected naming the
 * field, and is never partially applied. Partial application is the dangerous
 * one, because the engineer's next read shows a configuration nobody wrote.
 *
 * Everything runs against a user-data directory in the OS temp tree, injected
 * rather than taken from Electron, so none of this needs a runtime.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRegistry, type RegisteredRepository, type Registry } from '@main/registry/index';

const WINDOWS = process.platform === 'win32';

let userData: string;
let workspace: string;
let registry: Registry;

/** The registry's own file, so "not partially applied" can be checked in bytes. */
function registryFile(): string {
  return path.join(userData, 'config', 'repositories.json');
}

async function repoDirectory(name: string): Promise<string> {
  const directory = path.join(workspace, name);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function register(name: string, at: string): Promise<RegisteredRepository> {
  const result = await registry.add({
    name,
    path: at,
    packageId: 'almanac',
    packageVersion: '3.2.1',
  });
  if (!result.ok) throw new Error(`expected ${at} to register: ${result.message}`);
  return result.value;
}

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sdlc-registry-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'sdlc-workspace-'));
  registry = createRegistry(userData);
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// Registered twice
// ═════════════════════════════════════════════════════════════════════════════

describe('a repository registered twice (spec §Edge Cases)', () => {
  it('rejects the second registration rather than creating a duplicate', async () => {
    const directory = await repoDirectory('almanac');
    const first = await register('Almanac', directory);

    const second = await registry.add({
      name: 'Almanac again',
      path: directory,
      packageId: 'almanac',
      packageVersion: '3.2.1',
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('conflict');
    // Actionable (Principle V): which registration is in the way, and what to do.
    expect(second.message).toContain(first.name);
    expect(second.message).toContain(first.id);
    expect(second.field).toBe('path');
  });

  it('leaves exactly one registration behind, so nothing reconciles the directory twice', async () => {
    const directory = await repoDirectory('almanac');
    await register('Almanac', directory);
    await registry.add({ name: 'Almanac again', path: directory, packageId: 'almanac', packageVersion: '3.2.1' });

    const listed = await registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('Almanac');
  });

  it('coalesces a trailing separator, which a shell completion adds for free', async () => {
    const directory = await repoDirectory('almanac');
    await register('Almanac', directory);

    const again = await registry.add({
      name: 'Almanac with a slash',
      path: `${directory}${path.sep}`,
      packageId: 'almanac',
      packageVersion: '3.2.1',
    });

    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.reason).toBe('conflict');
    expect(await registry.list()).toHaveLength(1);
  });

  it('coalesces a path spelled with a redundant segment', async () => {
    const directory = await repoDirectory('almanac');
    await mkdir(path.join(directory, 'notes'), { recursive: true });
    await register('Almanac', directory);

    const again = await registry.add({
      name: 'Almanac the long way round',
      path: path.join(directory, 'notes', '..'),
      packageId: 'almanac',
      packageVersion: '3.2.1',
    });

    expect(again.ok ? '' : again.reason).toBe('conflict');
    expect(await registry.list()).toHaveLength(1);
  });

  it.runIf(WINDOWS)('coalesces two casings of one path, because the filesystem does', async () => {
    // On Windows these are one directory. Two registrations would reconcile the
    // same files twice and show the engineer two rows for one repository.
    const directory = await repoDirectory('Almanac');
    await register('Almanac', directory);

    const again = await registry.add({
      name: 'almanac in lower case',
      path: directory.toLowerCase(),
      packageId: 'almanac',
      packageVersion: '3.2.1',
    });

    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.reason).toBe('conflict');
    expect(await registry.list()).toHaveLength(1);
  });

  it.runIf(WINDOWS)('coalesces forward slashes with backslashes', async () => {
    const directory = await repoDirectory('almanac');
    await register('Almanac', directory);

    const again = await registry.add({
      name: 'Almanac with forward slashes',
      path: directory.replace(/\\/g, '/'),
      packageId: 'almanac',
      packageVersion: '3.2.1',
    });

    expect(again.ok ? '' : again.reason).toBe('conflict');
    expect(await registry.list()).toHaveLength(1);
  });

  it('still registers a genuinely different directory', async () => {
    // Without this, "reject everything" would pass every test above.
    const first = await repoDirectory('almanac');
    const second = await repoDirectory('cellar');
    await register('Almanac', first);

    const result = await registry.add({
      name: 'Cellar',
      path: second,
      packageId: 'almanac',
      packageVersion: '3.2.1',
    });

    expect(result.ok).toBe(true);
    expect(await registry.list()).toHaveLength(2);
  });

  it('accepts the path again once the first registration is removed', async () => {
    // The conflict is about a live duplicate, not a permanent ban on the path.
    const directory = await repoDirectory('almanac');
    const first = await register('Almanac', directory);
    expect((await registry.remove(first.id)).ok).toBe(true);

    const again = await registry.add({
      name: 'Almanac, re-registered',
      path: directory,
      packageId: 'almanac',
      packageVersion: '4.0.0',
    });
    expect(again.ok).toBe(true);
  });

  it('records the package and its version with the registration (FR-043)', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    expect(registered.packageId).toBe('almanac');
    expect(registered.packageVersion).toBe('3.2.1');
  });

  it('refuses a registration with no package version, naming the field (FR-043)', async () => {
    const directory = await repoDirectory('almanac');
    const result = await registry.add({
      name: 'Almanac',
      path: directory,
      packageId: 'almanac',
      packageVersion: '   ',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_input');
    expect(result.field).toBe('packageVersion');
  });

  it('refuses a registration with no name, naming the field', async () => {
    const directory = await repoDirectory('almanac');
    const result = await registry.add({
      name: '   ',
      path: directory,
      packageId: 'almanac',
      packageVersion: '3.2.1',
    });
    expect(result.ok ? '' : result.field).toBe('name');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Registered at a path that no longer exists
// ═════════════════════════════════════════════════════════════════════════════

describe('a repository whose path no longer exists (spec §Edge Cases)', () => {
  it('reports it as unavailable instead of throwing', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    await rm(directory, { recursive: true, force: true });

    // A throw here would reach the view as a rejected promise with a stack, which
    // cannot be rendered as an in-place error with a retry (Principle X).
    await expect(registry.availability(registered)).resolves.toBe('path_missing');
  });

  it('keeps the registration listed, so it can be re-pointed or removed', async () => {
    const directory = await repoDirectory('almanac');
    await register('Almanac', directory);
    await rm(directory, { recursive: true, force: true });

    const listed = await registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.path).toBe(path.resolve(directory));
  });

  it('leaves the rest of the registry usable', async () => {
    // This is the assertion the edge case is really about: one vanished directory
    // must not take down the view (FR-037).
    const gone = await repoDirectory('almanac');
    const present = await repoDirectory('cellar');
    const missing = await register('Almanac', gone);
    const survivor = await register('Cellar', present);
    await rm(gone, { recursive: true, force: true });

    expect(await registry.availability(missing)).toBe('path_missing');
    expect(await registry.availability(survivor)).toBe('available');
    expect((await registry.list()).map((entry) => entry.name).sort()).toEqual(['Almanac', 'Cellar']);

    // And every operation still works around it.
    const third = await repoDirectory('orchard');
    expect((await registry.add({ name: 'Orchard', path: third, packageId: 'almanac', packageVersion: '3.2.1' })).ok).toBe(true);
    expect((await registry.updateConfig(survivor.id, { depth: 2 })).ok).toBe(true);
    expect((await registry.remove(missing.id)).ok).toBe(true);
    expect(await registry.list()).toHaveLength(2);
  });

  it('reports a path that is now a file rather than a directory as unavailable', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    await rm(directory, { recursive: true, force: true });
    await writeFile(directory, 'not a repository any more', 'utf8');

    expect(await registry.availability(registered)).toBe('path_missing');
  });

  it('reports a path on a drive that is not mounted as unavailable, not as an error', async () => {
    const registered: RegisteredRepository = {
      id: 'phantom',
      name: 'Phantom',
      path: WINDOWS ? 'Q:\\not\\mounted\\almanac' : '/mnt/not-mounted/almanac',
      packageId: 'almanac',
      packageVersion: '3.2.1',
      config: {},
    };

    await expect(registry.availability(registered)).resolves.toBe('path_missing');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-025 — a rejected configuration is never partially applied
// ═════════════════════════════════════════════════════════════════════════════

describe('updateConfig is all or nothing (FR-025)', () => {
  it('applies an accepted update in full', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);

    const updated = await registry.updateConfig(registered.id, { depth: 3, label: 'nightly' });
    expect(updated.ok).toBe(true);
    expect((await registry.get(registered.id))?.config).toEqual({ depth: 3, label: 'nightly' });
  });

  it('retains the prior configuration when an update is rejected, naming the field', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    await registry.updateConfig(registered.id, { depth: 3 });

    // An array is not a map of field values. The point is not the array — it is
    // that a rejection leaves `depth` exactly as it was.
    const rejected = await registry.updateConfig(registered.id, [] as unknown as Record<string, unknown>);

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reason).toBe('invalid_input');
    expect(rejected.field).toBe('config');
    expect(rejected.message.length).toBeGreaterThan(0);
    expect((await registry.get(registered.id))?.config).toEqual({ depth: 3 });
  });

  it('writes nothing at all when an update is rejected', async () => {
    // "Not partially applied" is a claim about the bytes, not about the object
    // the next read happens to return, so this checks the bytes.
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    await registry.updateConfig(registered.id, { depth: 3 });
    const before = await readFile(registryFile(), 'utf8');

    const circular: Record<string, unknown> = { depth: 4 };
    circular['self'] = circular;
    const rejected = await registry.updateConfig(registered.id, circular);

    expect(rejected.ok).toBe(false);
    expect(rejected.ok ? '' : rejected.field).toBe('config');
    expect(await readFile(registryFile(), 'utf8')).toBe(before);
  });

  it('rejects a configuration that cannot be stored, naming the field rather than throwing', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);

    // A BigInt cannot be serialised. Reaching the write and failing there is what
    // would leave a half-written file behind.
    const result = await registry.updateConfig(registered.id, { depth: BigInt(4) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_input');
    expect(result.field).toBe('config');
    expect((await registry.get(registered.id))?.config).toEqual({});
  });

  it('rejects an update for an unknown repository, naming the field, and touches nothing', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    const before = await readFile(registryFile(), 'utf8');

    const result = await registry.updateConfig('not-a-registration', { depth: 9 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_found');
    expect(result.field).toBe('id');
    expect(await readFile(registryFile(), 'utf8')).toBe(before);
    expect((await registry.get(registered.id))?.config).toEqual({});
  });

  it('leaves every other registration untouched when one update is rejected', async () => {
    const first = await repoDirectory('almanac');
    const second = await repoDirectory('cellar');
    const almanac = await register('Almanac', first);
    const cellar = await register('Cellar', second);
    await registry.updateConfig(cellar.id, { depth: 7 });

    await registry.updateConfig(almanac.id, null as unknown as Record<string, unknown>);

    expect((await registry.get(cellar.id))?.config).toEqual({ depth: 7 });
    expect(await registry.list()).toHaveLength(2);
  });

  it('does not let a caller mutate the stored configuration through a returned object', async () => {
    // Principle VIII: no hidden coupling. A returned registration that aliased the
    // store would let any caller edit configuration without going through the
    // validation above.
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    const updated = await registry.updateConfig(registered.id, { depth: 3 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    updated.value.config['depth'] = 999;
    expect((await registry.get(registered.id))?.config).toEqual({ depth: 3 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A damaged registry file
// ═════════════════════════════════════════════════════════════════════════════

describe('a registry file that cannot be read', () => {
  it('starts empty rather than throwing, and the next registration succeeds', async () => {
    // Registrations cannot be rebuilt from any system of record, so the file is
    // moved aside rather than overwritten — but the application still has to open
    // (Principle I).
    await mkdir(path.dirname(registryFile()), { recursive: true });
    await writeFile(registryFile(), 'this is not JSON', 'utf8');

    await expect(registry.list()).resolves.toEqual([]);

    const directory = await repoDirectory('almanac');
    expect((await registry.add({ name: 'Almanac', path: directory, packageId: 'almanac', packageVersion: '3.2.1' })).ok).toBe(true);
    expect(await registry.list()).toHaveLength(1);
  });

  it('costs one malformed entry rather than the whole registry', async () => {
    const directory = await repoDirectory('almanac');
    const registered = await register('Almanac', directory);
    const document = JSON.parse(await readFile(registryFile(), 'utf8')) as {
      repositories: unknown[];
    };
    document.repositories.push({ id: 'broken' });
    await writeFile(registryFile(), JSON.stringify(document), 'utf8');

    const listed = await registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(registered.id);
  });
});
