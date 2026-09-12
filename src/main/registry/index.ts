/**
 * T039, T102 — the repository registry (FR-023, FR-025, FR-043, spec §Edge Cases).
 *
 * ## Why this does not live under `cache/v1/`
 *
 * data-model.md §Cache draws `repositories.json` inside `<userData>/cache/v1/`.
 * This module deliberately does not follow it there; registrations live at
 * `<userData>/config/repositories.json` instead.
 *
 * The reason is a direct conflict between two requirements. Deleting the cache tree
 * is a supported recovery path (FR-038), and quickstart scenario V8 / SC-009 require
 * that deleting it and reopening reproduces *identical* item state. That is
 * impossible if deleting the cache also unregisters every repository: there would be
 * nothing left to rebuild from. A registration is not derived data — it cannot be
 * recovered from any system of record, because it is the thing that says which
 * systems of record to ask. It is local *configuration*, which is exactly what
 * ipc-surface.md rule 1 calls it, and FR-038 scopes the word "cache" to work-item
 * data. So registrations sit under `config/` and survive a cache wipe, and the
 * documentation inconsistency is reported separately.
 *
 * ## Degenerate registrations (T102)
 *
 * Two failure modes the spec calls out by name, both handled here rather than left
 * to the UI:
 *
 *   - **Registered twice.** `add` compares normalised absolute paths — case
 *     insensitively on Windows, whose filesystem is — and returns `conflict`
 *     naming the existing registration instead of creating a second one.
 *   - **Registered at a path that no longer exists.** `availability` reports
 *     `path_missing`; it never throws. The repository stays listed and the other
 *     registrations keep working, because a vanished directory must not be able to
 *     take down the view (Principle III's blast-radius rule, FR-037).
 *
 * No `electron` import: the user-data directory is injected, so all of this is
 * testable in a bare node environment (Principle IV, Principle VIII).
 */

import { randomUUID } from 'node:crypto';
import { rename, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Result } from '@core/model/result.js';
import { fail, ok } from '@core/model/result.js';

import { parseJsonOrNull, readTextOrNull, writeFileAtomic } from '../cache/index.js';

export interface RegisteredRepository {
  id: string;
  name: string;
  path: string;
  packageId: string;
  packageVersion: string;
  config: Record<string, unknown>;
}

export interface Registry {
  list(): Promise<RegisteredRepository[]>;
  get(id: string): Promise<RegisteredRepository | undefined>;
  add(input: {
    name: string;
    path: string;
    packageId: string;
    packageVersion: string;
    config?: Record<string, unknown>;
  }): Promise<Result<RegisteredRepository>>;
  updateConfig(id: string, config: Record<string, unknown>): Promise<Result<RegisteredRepository>>;
  remove(id: string): Promise<Result<void>>;
  /** 'available' | 'path_missing' — a vanished path never crashes the view. */
  availability(repository: RegisteredRepository): Promise<'available' | 'path_missing'>;
}

/** Bumped only if the on-disk shape changes; unlike the cache, this file is migrated, never discarded. */
const REGISTRY_FILE_VERSION = 1;

export function createRegistry(userDataDir: string): Registry {
  const configDir = path.join(userDataDir, 'config');
  const registryFile = path.join(configDir, 'repositories.json');

  /**
   * Closure state, not module state (Principle VIII): two registries over two
   * directories must not share a flag. It only records that the quarantine below
   * has already run, so a damaged file is moved aside once rather than on every read.
   */
  let quarantined = false;

  const load = async (): Promise<RegisteredRepository[]> => {
    const raw = await readTextOrNull(registryFile);
    if (raw === null) return [];
    const parsed = parseJsonOrNull(raw);
    const entries = extractEntries(parsed);
    if (entries === null) {
      // Unlike the cache, this file cannot be rebuilt from anywhere, so it is moved
      // aside rather than overwritten by the next `add`. Best effort: failing to
      // quarantine must not stop the app from starting (Principle I).
      if (!quarantined) {
        quarantined = true;
        try {
          await rename(registryFile, `${registryFile}.invalid-${Date.now()}`);
        } catch {
          // The next write replaces it anyway; nothing further to do here.
        }
      }
      return [];
    }
    // One malformed entry costs that one registration, never the whole registry.
    return entries.filter(isRegisteredRepository).map(copyRepository);
  };

  const persist = async (repositories: readonly RegisteredRepository[]): Promise<void> => {
    const document = { version: REGISTRY_FILE_VERSION, repositories };
    // Serialise the whole file before touching disk, then write it atomically: an
    // update either lands complete or not at all (FR-025, never partially applied).
    await writeFileAtomic(registryFile, `${JSON.stringify(document, null, 2)}\n`);
  };

  return {
    async list(): Promise<RegisteredRepository[]> {
      return load();
    },

    async get(id: string): Promise<RegisteredRepository | undefined> {
      const repositories = await load();
      return repositories.find((repository) => repository.id === id);
    },

    async add(input: {
      name: string;
      path: string;
      packageId: string;
      packageVersion: string;
      config?: Record<string, unknown>;
    }): Promise<Result<RegisteredRepository>> {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (name.length === 0) {
        return fail('invalid_input', 'A repository needs a name.', { field: 'name' });
      }
      if (typeof input.path !== 'string' || input.path.trim().length === 0) {
        return fail('invalid_input', 'A repository needs a path on disk.', { field: 'path' });
      }
      if (typeof input.packageId !== 'string' || input.packageId.trim().length === 0) {
        return fail(
          'invalid_input',
          'A repository must be associated with an SDLC package (FR-043).',
          { field: 'packageId' },
        );
      }
      if (typeof input.packageVersion !== 'string' || input.packageVersion.trim().length === 0) {
        return fail(
          'invalid_input',
          'The SDLC package version must be recorded with the registration (FR-043).',
          { field: 'packageVersion' },
        );
      }

      const config = input.config ?? {};
      const configProblem = describeConfigProblem(config);
      if (configProblem !== null) {
        return fail('invalid_input', configProblem, { field: 'config' });
      }

      const absolutePath = normalisePath(input.path);
      const repositories = await load();
      const existing = repositories.find((repository) =>
        samePath(repository.path, absolutePath),
      );
      if (existing !== undefined) {
        return fail(
          'conflict',
          `${absolutePath} is already registered as "${existing.name}" (${existing.id}). ` +
            'Edit that registration, or remove it before registering the path again.',
          { field: 'path' },
        );
      }

      const repository: RegisteredRepository = {
        id: randomUUID(),
        name,
        path: absolutePath,
        packageId: input.packageId.trim(),
        packageVersion: input.packageVersion.trim(),
        config: { ...config },
      };
      await persist([...repositories, repository]);
      return ok(copyRepository(repository));
    },

    /**
     * FR-025: never partially applied. Every rejection returns before a single byte
     * is written, so the prior configuration is retained intact; an accepted update
     * replaces the whole file in one atomic rename.
     *
     * Validating the values against the package's `repo_config` declarations belongs
     * to the IPC layer, which holds the manifest. This layer owns atomicity, and
     * rejects only what it can judge on its own: that the configuration is a
     * serialisable object.
     */
    async updateConfig(
      id: string,
      config: Record<string, unknown>,
    ): Promise<Result<RegisteredRepository>> {
      const repositories = await load();
      const index = repositories.findIndex((repository) => repository.id === id);
      const current = repositories[index];
      if (current === undefined) {
        return fail('not_found', `No repository is registered with id ${id}.`, { field: 'id' });
      }

      const problem = describeConfigProblem(config);
      if (problem !== null) {
        return fail('invalid_input', problem, { field: 'config' });
      }

      const updated: RegisteredRepository = { ...current, config: { ...config } };
      const next = [...repositories];
      next[index] = updated;
      await persist(next);
      return ok(copyRepository(updated));
    },

    async remove(id: string): Promise<Result<void>> {
      const repositories = await load();
      const remaining = repositories.filter((repository) => repository.id !== id);
      if (remaining.length === repositories.length) {
        return fail('not_found', `No repository is registered with id ${id}.`, { field: 'id' });
      }
      await persist(remaining);
      return ok(undefined);
    },

    /**
     * Never throws. A path that has been deleted, renamed, or is on a drive that is
     * not mounted reports `path_missing`, and the repository remains listed so the
     * engineer can re-point or remove it (spec §Edge Cases, Principle X).
     */
    async availability(
      repository: RegisteredRepository,
    ): Promise<'available' | 'path_missing'> {
      try {
        const stats = await stat(repository.path);
        return stats.isDirectory() ? 'available' : 'path_missing';
      } catch {
        return 'path_missing';
      }
    },
  };
}

/** Absolute, separator-normalised, and without a trailing separator, so two spellings of one directory compare equal. */
function normalisePath(value: string): string {
  const absolute = path.resolve(value.trim());
  const parsed = path.parse(absolute);
  if (absolute === parsed.root) return absolute;
  return absolute.replace(/[\\/]+$/, '');
}

/** Windows filesystems are case insensitive, so two spellings of one path are one registration there. */
function samePath(left: string, right: string): boolean {
  const a = normalisePath(left);
  const b = normalisePath(right);
  if (process.platform === 'win32') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/**
 * What this layer can judge without the manifest: the configuration must be a plain
 * object and must survive a JSON round trip, because it is going to be written as
 * one. Naming the field and the reason is FR-025's requirement.
 */
function describeConfigProblem(config: unknown): string | null {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return 'Repository configuration must be an object of field values.';
  }
  try {
    JSON.stringify(config);
  } catch {
    return 'Repository configuration must be serialisable; it contains a value that cannot be stored.';
  }
  return null;
}

/** `null` means the file itself is unreadable, as opposed to an empty registry. */
function extractEntries(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object' && parsed !== null) {
    const repositories = (parsed as { repositories?: unknown }).repositories;
    if (Array.isArray(repositories)) return repositories;
  }
  return null;
}

function isRegisteredRepository(value: unknown): value is RegisteredRepository {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<Record<keyof RegisteredRepository, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.packageId === 'string' &&
    typeof candidate.packageVersion === 'string' &&
    (candidate.config === undefined ||
      (typeof candidate.config === 'object' &&
        candidate.config !== null &&
        !Array.isArray(candidate.config)))
  );
}

/** Callers get their own object, so mutating a returned registration cannot reach the store. */
function copyRepository(repository: RegisteredRepository): RegisteredRepository {
  return {
    id: repository.id,
    name: repository.name,
    path: repository.path,
    packageId: repository.packageId,
    packageVersion: repository.packageVersion,
    config: { ...repository.config },
  };
}
