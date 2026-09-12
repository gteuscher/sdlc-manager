/**
 * T041 — the credential store (Principle III, FR-035, ipc-surface.md rule 3).
 *
 * The only module in the application that touches a credential. Everything else
 * asks `has` or `listConfigured`; only a provider adapter, in the main process,
 * ever calls `get`.
 *
 * The guarantees, in order of how badly breaking one would hurt:
 *
 *   1. **Only ciphertext reaches disk.** The plaintext exists as a parameter to
 *      `set` and as the return of `get`, and nowhere else. When the OS keychain is
 *      unavailable, `set` fails with `unavailable` and writes *nothing* — there is
 *      no plaintext fallback, because a fallback is the whole vulnerability.
 *   2. **No credential appears in a log line, a thrown value, or a `Result`
 *      message.** This module never logs at all, and never interpolates a secret,
 *      a provider's error text, or a decode failure into a message. Constitution
 *      Principle III forbids credentials in logs and telemetry; the cheapest way to
 *      keep that true is to have no code path that could put one there.
 *   3. **Nothing returns a secret across IPC.** That is the IPC layer's rule, but
 *      it is only enforceable because `get` is a main-process call with no handler
 *      exposing it (ipc-surface.md rule 3).
 *
 * The encryption backend is injected rather than imported. Electron's `safeStorage`
 * satisfies `SafeStorageLike`, and the composition root passes it; a test passes a
 * reversible fake. So this file imports no `electron` and runs in a bare node test
 * (Principle IV, Principle VIII).
 *
 * Secrets live at `<userData>/config/secrets.json`, alongside the repository
 * registry and outside the cache tree: they are local configuration, and deleting
 * the cache (FR-038) must not silently sign the engineer out of every provider.
 */

import { chmod } from 'node:fs/promises';
import path from 'node:path';

import type { Result } from '@core/model/result.js';
import { fail, ok } from '@core/model/result.js';

import { parseJsonOrNull, readTextOrNull, writeFileAtomic } from '../cache/index.js';

/** The subset of Electron's `safeStorage` this module uses. Injected, so it is fakeable. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecretStore {
  set(providerId: string, secret: string): Promise<Result<void>>;
  get(providerId: string): Promise<string | undefined>;
  has(providerId: string): Promise<boolean>;
  remove(providerId: string): Promise<Result<void>>;
  listConfigured(): Promise<string[]>;
}

const SECRETS_FILE_VERSION = 1;

/** Said in full wherever encryption is missing, so the engineer knows why nothing was saved. */
const UNAVAILABLE_MESSAGE =
  'This machine has no OS credential encryption available, so the credential was not saved. ' +
  'Storing it unencrypted is not offered. Unlock the system keyring and try again, or supply ' +
  'the credential through the environment instead.';

export function createSecretStore(userDataDir: string, backend: SafeStorageLike): SecretStore {
  const secretsFile = path.join(userDataDir, 'config', 'secrets.json');

  /** Provider id to base64 ciphertext. Never plaintext, at any point in its life. */
  const load = async (): Promise<Map<string, string>> => {
    const raw = await readTextOrNull(secretsFile);
    if (raw === null) return new Map();
    const parsed = parseJsonOrNull(raw);
    const entries = new Map<string, string>();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return entries;
    const secrets = (parsed as { secrets?: unknown }).secrets;
    if (typeof secrets !== 'object' || secrets === null || Array.isArray(secrets)) return entries;
    for (const [providerId, ciphertext] of Object.entries(secrets)) {
      if (typeof ciphertext === 'string') entries.set(providerId, ciphertext);
    }
    return entries;
  };

  const persist = async (entries: ReadonlyMap<string, string>): Promise<void> => {
    const secrets: Record<string, string> = {};
    for (const [providerId, ciphertext] of [...entries].sort(byProviderId)) {
      secrets[providerId] = ciphertext;
    }
    const document = { version: SECRETS_FILE_VERSION, secrets };
    await writeFileAtomic(secretsFile, `${JSON.stringify(document, null, 2)}\n`);
    try {
      // Owner-only where the platform honours it. A no-op on Windows, which is why
      // it is best effort rather than a failure path.
      await chmod(secretsFile, 0o600);
    } catch {
      // Nothing to report: the ciphertext is already safely written, and the mode
      // is defence in depth rather than the defence.
    }
  };

  return {
    async set(providerId: string, secret: string): Promise<Result<void>> {
      const id = typeof providerId === 'string' ? providerId.trim() : '';
      if (id.length === 0) {
        return fail('invalid_input', 'A provider id is required to store a credential.', {
          field: 'providerId',
        });
      }
      if (typeof secret !== 'string' || secret.length === 0) {
        // Says that the value was empty; never says what the value was.
        return fail('invalid_input', 'The credential was empty, so nothing was saved.', {
          field: 'secret',
        });
      }
      if (!backend.isEncryptionAvailable()) {
        return fail('unavailable', UNAVAILABLE_MESSAGE);
      }

      let ciphertext: string;
      try {
        ciphertext = backend.encryptString(secret).toString('base64');
      } catch {
        // The thrown value is deliberately discarded rather than wrapped: a backend
        // error can echo its input, and that input is the credential (Principle III).
        return fail(
          'unavailable',
          'The credential could not be encrypted, so nothing was written to disk. ' +
            'Check that the system keyring is unlocked and try again.',
        );
      }

      const entries = await load();
      entries.set(id, ciphertext);
      await persist(entries);
      return ok(undefined);
    },

    /**
     * The only path that decrypts. Returns `undefined` — never a `Result` carrying
     * a message — when there is nothing to return, so no failure text can ever be
     * built from a credential or from a decryption error.
     */
    async get(providerId: string): Promise<string | undefined> {
      const entries = await load();
      const ciphertext = entries.get(providerId.trim());
      if (ciphertext === undefined) return undefined;
      if (!backend.isEncryptionAvailable()) return undefined;
      try {
        return backend.decryptString(Buffer.from(ciphertext, 'base64'));
      } catch {
        // A credential encrypted under a key this machine no longer holds. It reads
        // as unconfigured, which is the actionable state: the engineer re-enters it.
        return undefined;
      }
    },

    /** Answers the renderer's only legitimate question about a credential: is there one? */
    async has(providerId: string): Promise<boolean> {
      const entries = await load();
      return entries.has(providerId.trim());
    },

    async remove(providerId: string): Promise<Result<void>> {
      const id = providerId.trim();
      const entries = await load();
      if (!entries.delete(id)) {
        return fail('not_found', `No credential is stored for provider "${id}".`, {
          field: 'providerId',
        });
      }
      await persist(entries);
      return ok(undefined);
    },

    /** Provider ids only. This is what FR-035's "which providers are unconfigured" is answered from. */
    async listConfigured(): Promise<string[]> {
      const entries = await load();
      return [...entries.keys()].sort();
    },
  };
}

function byProviderId(left: readonly [string, string], right: readonly [string, string]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}
