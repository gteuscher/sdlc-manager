/**
 * T096 — repository configuration validation (FR-024, FR-025).
 *
 * Two claims, which together are the whole of FR-025:
 *
 *   **An invalid value is rejected naming the offending field and the reason.**
 *   "Configuration rejected" is not a usable message when a lifecycle declares
 *   six settings; the engineer has to be told which one and why, in the words of
 *   the declaration rather than of the code (Principle V).
 *
 *   **The prior configuration is retained.** This is the dangerous half. A
 *   partially applied update leaves a configuration nobody wrote — half the old
 *   values, half the new — and the next read looks plausible. So the checks below
 *   read the stored bytes back after every rejection, rather than trusting the
 *   returned `Result`.
 *
 * The two layers are tested where each one's responsibility lies. The IPC layer
 * owns validation against the package's `repo_config` declarations, because that
 * is where the manifest is held; the registry owns atomicity, because that is
 * where the write happens. The last block runs them in the order the handler runs
 * them, which is the property that actually protects the stored file: nothing
 * reaches the registry until validation has passed.
 *
 * Every lifecycle below is invented. A test that could only validate settings
 * named in the specs would prove nothing about SC-003 — the claim is that an
 * unfamiliar lifecycle's declarations are honoured exactly as well as a familiar
 * one's. The temp directories are under the OS temp tree and removed afterwards;
 * nothing is written inside the repository.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateRepositoryConfig } from '@main/ipc/repositories';
import { createRegistry, type Registry } from '@main/registry/index';
import type { ConfigField } from '@core/model/declared';

/**
 * The declarations of a lifecycle this application has never seen: a required
 * setting, an optional one with a default, a numeric one, and a flag that a
 * configurable gate reads. Only their shape matters to the code under test.
 */
const DECLARED: readonly ConfigField[] = [
  { key: 'providers.almanac.ledgerKey', title: 'Almanac ledger key', type: 'string', required: true },
  {
    key: 'gates.countersigned.approver',
    title: 'Countersigning approver',
    type: 'string',
    required: false,
    default: 'duty-officer',
    description: 'Whose countersignature the gate reads.',
  },
  { key: 'providers.almanac.pageSize', title: 'Entries per page', type: 'number', required: false },
  { key: 'gates.countersigned.strict', title: 'Strict countersigning', type: 'boolean', required: false },
];

const VALID: Record<string, unknown> = {
  'providers.almanac.ledgerKey': 'LEDGER-77',
  'gates.countersigned.approver': 'night-warden',
  'providers.almanac.pageSize': 50,
  'gates.countersigned.strict': true,
};

let userData: string;
let workspace: string;
let registry: Registry;

function registryFile(): string {
  return path.join(userData, 'config', 'repositories.json');
}

async function storedConfig(id: string): Promise<Record<string, unknown>> {
  const registered = await registry.get(id);
  if (registered === undefined) throw new Error(`expected ${id} to still be registered`);
  return registered.config;
}

async function registerAlmanac(): Promise<string> {
  const directory = path.join(workspace, 'almanac');
  await mkdir(directory, { recursive: true });
  const added = await registry.add({
    name: 'Almanac',
    path: directory,
    packageId: 'almanac',
    packageVersion: '3.2.1',
    config: { ...VALID },
  });
  if (!added.ok) throw new Error(`expected the fixture to register: ${added.message}`);
  return added.value.id;
}

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'sdlc-config-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'sdlc-config-work-'));
  registry = createRegistry(userData);
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// Validation against the package's declarations
// ═════════════════════════════════════════════════════════════════════════════

describe('a repository configuration validated against its SDLC package (FR-024)', () => {
  it('accepts a configuration whose values match every declaration', () => {
    const result = validateRepositoryConfig(DECLARED, VALID);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : {}).toEqual(VALID);
  });

  it('accepts an optional setting left unset, because the package declares its default', () => {
    const result = validateRepositoryConfig(DECLARED, {
      'providers.almanac.ledgerKey': 'LEDGER-77',
    });

    expect(result.ok).toBe(true);
  });

  it('names the field and the reason when a required setting is missing', () => {
    const result = validateRepositoryConfig(DECLARED, {
      'gates.countersigned.approver': 'night-warden',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_input');
    // The key, so the interface can render the message against that input.
    expect(result.field).toBe('providers.almanac.ledgerKey');
    // The declaration's own title, so the engineer reads the words the package used.
    expect(result.message).toContain('Almanac ledger key');
    expect(result.message).toMatch(/required/i);
  });

  it('names the field and the reason when a value is of the wrong type', () => {
    const result = validateRepositoryConfig(DECLARED, {
      ...VALID,
      'providers.almanac.pageSize': 'fifty',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('providers.almanac.pageSize');
    expect(result.message).toContain('Entries per page');
    expect(result.message).toMatch(/must be a number/i);
    // The shape of the rejected value, never its content — a value may be a secret.
    expect(result.message).not.toContain('fifty');
  });

  it('rejects a flag supplied as text rather than coercing it to true', () => {
    const result = validateRepositoryConfig(DECLARED, {
      ...VALID,
      'gates.countersigned.strict': 'yes',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('gates.countersigned.strict');
    expect(result.message).toMatch(/true or false/i);
  });

  it('rejects a setting the package never declared, naming it and listing what is accepted', () => {
    const result = validateRepositoryConfig(DECLARED, {
      ...VALID,
      'providers.almanac.ledgerkey': 'LEDGER-77',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A typo in a key is reported rather than stored where it can never be read.
    expect(result.field).toBe('providers.almanac.ledgerkey');
    expect(result.message).toContain('providers.almanac.ledgerKey');
  });

  it('honours a declaration it has never seen, with no knowledge of that lifecycle (SC-003)', () => {
    const unfamiliar: readonly ConfigField[] = [
      { key: 'providers.orrery.epoch', title: 'Orrery epoch', type: 'string', required: true },
      { key: 'gates.aligned.tolerance', title: 'Alignment tolerance', type: 'number', required: true },
    ];

    const accepted = validateRepositoryConfig(unfamiliar, {
      'providers.orrery.epoch': 'J2000',
      'gates.aligned.tolerance': 0.25,
    });
    expect(accepted.ok).toBe(true);

    const rejected = validateRepositoryConfig(unfamiliar, { 'providers.orrery.epoch': 'J2000' });
    expect(rejected.ok).toBe(false);
    expect(rejected.ok ? '' : rejected.field).toBe('gates.aligned.tolerance');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The prior configuration is retained
// ═════════════════════════════════════════════════════════════════════════════

describe('an update the registry itself refuses (FR-025)', () => {
  it('names the field and leaves the stored configuration byte-for-byte unchanged', async () => {
    const id = await registerAlmanac();
    const before = await readFile(registryFile(), 'utf8');

    // Not an object of field values: the one thing this layer can judge without
    // the manifest, and the one that would corrupt the file if it were written.
    const result = await registry.updateConfig(
      id,
      ['providers.almanac.ledgerKey', 'LEDGER-99'] as unknown as Record<string, unknown>,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_input');
    expect(result.field).toBe('config');

    expect(await readFile(registryFile(), 'utf8')).toBe(before);
    expect(await storedConfig(id)).toEqual(VALID);
  });

  it('refuses an update for a repository that is not registered, writing nothing', async () => {
    const id = await registerAlmanac();
    const before = await readFile(registryFile(), 'utf8');

    const result = await registry.updateConfig('00000000-0000-4000-8000-000000000000', {
      'providers.almanac.ledgerKey': 'LEDGER-99',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('not_found');
    expect(await readFile(registryFile(), 'utf8')).toBe(before);
    expect(await storedConfig(id)).toEqual(VALID);
  });

  it('replaces the configuration wholly when it is accepted, rather than merging into it', async () => {
    const id = await registerAlmanac();

    const result = await registry.updateConfig(id, {
      'providers.almanac.ledgerKey': 'LEDGER-99',
    });

    expect(result.ok).toBe(true);
    // A key absent from the accepted configuration is gone, not silently carried
    // over: the stored object is what the engineer saved, not a merge of two.
    expect(await storedConfig(id)).toEqual({ 'providers.almanac.ledgerKey': 'LEDGER-99' });
  });

  it('leaves every other registration untouched when one update is refused', async () => {
    const first = await registerAlmanac();
    const otherDirectory = path.join(workspace, 'orrery');
    await mkdir(otherDirectory, { recursive: true });
    const second = await registry.add({
      name: 'Orrery',
      path: otherDirectory,
      packageId: 'orrery',
      packageVersion: '0.9.0',
      config: { 'providers.orrery.epoch': 'J2000' },
    });
    if (!second.ok) throw new Error('expected the second fixture to register');

    await registry.updateConfig(first, 'not an object' as unknown as Record<string, unknown>);

    expect(await storedConfig(first)).toEqual(VALID);
    expect(await storedConfig(second.value.id)).toEqual({ 'providers.orrery.epoch': 'J2000' });
    expect(await registry.list()).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The two together, in the order the handler runs them
// ═════════════════════════════════════════════════════════════════════════════

describe('validation and persistence composed as the update handler composes them', () => {
  /** Exactly the sequence `updateRepositoryConfig` performs: validate, then write. */
  async function save(id: string, config: Record<string, unknown>) {
    const validation = validateRepositoryConfig(DECLARED, config);
    if (!validation.ok) return validation;
    return registry.updateConfig(id, validation.value);
  }

  it('never reaches the registry with a configuration the declarations reject', async () => {
    const id = await registerAlmanac();
    const before = await readFile(registryFile(), 'utf8');

    const result = await save(id, { ...VALID, 'providers.almanac.pageSize': 'fifty' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('providers.almanac.pageSize');
    expect(result.message).toContain('Entries per page');

    // The whole point: the rejection happened before the write, so what the
    // repository still uses is what it used before.
    expect(await readFile(registryFile(), 'utf8')).toBe(before);
    expect(await storedConfig(id)).toEqual(VALID);
  });

  it('retains the prior configuration through a run of rejected saves', async () => {
    const id = await registerAlmanac();

    await save(id, { 'gates.countersigned.approver': 'night-warden' });
    await save(id, { ...VALID, 'gates.countersigned.strict': 'yes' });
    await save(id, { ...VALID, 'providers.almanac.unknown': 1 });

    expect(await storedConfig(id)).toEqual(VALID);
  });

  it('applies an accepted save in full', async () => {
    const id = await registerAlmanac();

    const result = await save(id, { ...VALID, 'gates.countersigned.approver': 'duty-registrar' });

    expect(result.ok).toBe(true);
    expect(await storedConfig(id)).toEqual({
      ...VALID,
      'gates.countersigned.approver': 'duty-registrar',
    });
  });
});
