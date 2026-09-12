/**
 * T055 — credential handling (Principle III, ipc-surface.md rule 3).
 *
 * Three claims, each asserted rather than assumed:
 *   1. `safeStorage` ciphertext is all that reaches disk.
 *   2. No credential crosses the IPC surface in either direction.
 *   3. No credential appears in a log line, an error, or a returned failure.
 *
 * Claim 2 is the interesting one to test, because it is a claim about something
 * that does not exist. It is asserted against the published wire schemas: if a
 * future reply schema were to gain a field carrying a secret, this test is what
 * notices.
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSecretStore, type SafeStorageLike } from '@main/secrets/index';
import {
  artifactContentSchema,
  changeEventSchema,
  conversationReplySchema,
  getItemReplySchema,
  listItemsReplySchema,
  listPackagesReplySchema,
  listRepositoriesReplySchema,
  messageResultSchema,
  repositoryResultSchema,
  voidResultSchema,
} from '@core/ipc/schema';

const SECRET = 'super-secret-token-4f9a2b';

/** A stand-in for Electron's safeStorage. Reversible, but not plaintext. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc::${Buffer.from(plain, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted) => {
      const raw = encrypted.toString('utf8');
      if (!raw.startsWith('enc::')) throw new Error('not ciphertext');
      return Buffer.from(raw.slice('enc::'.length), 'base64').toString('utf8');
    },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sdlc-secrets-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Every byte under the user-data directory, so nothing can hide in a stray file. */
async function allBytesUnder(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const contents: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath ?? root, entry.name);
    contents.push(await readFile(path, 'utf8'));
  }
  return contents.join('\n');
}

describe('only ciphertext reaches disk', () => {
  it('stores a credential without writing it in plaintext anywhere', async () => {
    const store = createSecretStore(dir, fakeSafeStorage());
    expect((await store.set('tracker', SECRET)).ok).toBe(true);

    const onDisk = await allBytesUnder(dir);
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it('reads the credential back, so the encryption is real rather than destructive', async () => {
    const store = createSecretStore(dir, fakeSafeStorage());
    await store.set('tracker', SECRET);
    expect(await store.get('tracker')).toBe(SECRET);
  });

  it('reports which providers are configured without revealing any of their secrets', async () => {
    const store = createSecretStore(dir, fakeSafeStorage());
    await store.set('tracker', SECRET);
    const configured = await store.listConfigured();
    expect(configured).toContain('tracker');
    expect(JSON.stringify(configured)).not.toContain(SECRET);
  });

  it('reports an unconfigured provider as absent rather than empty-stringed', async () => {
    const store = createSecretStore(dir, fakeSafeStorage());
    expect(await store.get('tracker')).toBeUndefined();
    expect(await store.has('tracker')).toBe(false);
  });

  it('writes nothing at all when the platform cannot encrypt — never a plaintext fallback', async () => {
    const store = createSecretStore(dir, fakeSafeStorage(false));
    const result = await store.set('tracker', SECRET);

    expect(result.ok).toBe(false);
    expect(await allBytesUnder(dir)).not.toContain(SECRET);
  });
});

describe('no credential appears in a log line, an error, or a failure', () => {
  it('keeps the secret out of every console channel', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    const store = createSecretStore(dir, fakeSafeStorage());
    await store.set('tracker', SECRET);
    await store.get('tracker');
    await store.get('absent-provider');
    await store.remove('tracker');
    await store.remove('tracker');

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SECRET);
      }
    }
  });

  it('keeps the secret out of a failure message when encryption is unavailable', async () => {
    const store = createSecretStore(dir, fakeSafeStorage(false));
    const result = await store.set('tracker', SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('keeps the secret out of a failure when the backend throws', async () => {
    const exploding: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('keychain unavailable');
      },
      decryptString: () => {
        throw new Error('keychain unavailable');
      },
    };
    const store = createSecretStore(dir, exploding);
    const result = await store.set('tracker', SECRET);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('no credential crosses the IPC surface in either direction', () => {
  /** Walks a Zod schema's shape for any key that looks like it carries a secret. */
  function keysOf(schema: unknown, seen = new Set<unknown>(), depth = 0): string[] {
    if (depth > 8 || schema === null || typeof schema !== 'object' || seen.has(schema)) return [];
    seen.add(schema);
    const found: string[] = [];
    const def = (schema as { _def?: Record<string, unknown> })._def;
    if (def === undefined) return [];

    const shape = def['shape'];
    if (typeof shape === 'function') {
      for (const [key, value] of Object.entries(shape() as Record<string, unknown>)) {
        found.push(key, ...keysOf(value, seen, depth + 1));
      }
    }
    for (const key of ['type', 'innerType', 'valueType', 'schema', 'element']) {
      if (def[key] !== undefined) found.push(...keysOf(def[key], seen, depth + 1));
    }
    for (const key of ['options', 'items']) {
      const list = def[key];
      if (Array.isArray(list)) {
        for (const option of list) found.push(...keysOf(option, seen, depth + 1));
      }
    }
    return found;
  }

  const replySchemas = {
    listPackages: listPackagesReplySchema,
    listRepositories: listRepositoriesReplySchema,
    listItems: listItemsReplySchema,
    getItem: getItemReplySchema,
    getArtifact: artifactContentSchema,
    registerRepository: repositoryResultSchema,
    setCredential: voidResultSchema,
    refresh: voidResultSchema,
    askConsole: messageResultSchema,
    getConversation: conversationReplySchema,
    changed: changeEventSchema,
  };

  const secretish = /(secret|credential|token|password|apikey|api_key|auth)/i;

  it.each(Object.entries(replySchemas))('the %s reply carries no credential-shaped field', (_name, schema) => {
    const offending = keysOf(schema).filter((key) => secretish.test(key));
    expect(offending).toEqual([]);
  });

  it('setCredential passes a secret in and returns nothing but success or a typed failure', () => {
    // The asymmetry is the point: a secret can be written, and can never be read
    // back across the bridge (ipc-surface.md rule 3).
    const parsed = voidResultSchema.safeParse({ ok: true, value: undefined });
    expect(parsed.success).toBe(true);
    expect(keysOf(voidResultSchema).filter((key) => secretish.test(key))).toEqual([]);
  });

  it('a repository reply carries provider status, never a provider secret', () => {
    const keys = keysOf(repositoryResultSchema);
    expect(keys).toContain('providerStatus');
    expect(keys.filter((key) => secretish.test(key))).toEqual([]);
  });
});
