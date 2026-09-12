/**
 * T040 — the versioned, non-authoritative work-item cache (data-model.md §Cache).
 *
 * Layout, rooted at the Electron user-data directory:
 *
 *   <userData>/cache/v1/items/<repositoryId>.json
 *   <userData>/cache/v1/transitions/<repositoryId>.jsonl     (transitions.ts)
 *   <userData>/cache/v1/conversations/<itemKey>/<stateId>.json (conversations.ts)
 *
 * Three properties this module exists to guarantee:
 *
 *   1. The `v1` segment is a cache schema version. A version directory this build
 *      does not recognise is *discarded*, never read: a cache is non-authoritative
 *      and always rebuildable from the system of record (Principle VI, FR-038), so
 *      misreading an older shape is strictly worse than rebuilding.
 *   2. Deleting the whole tree is a supported recovery path — `clear()` — and the
 *      next read reproduces identical item state from the providers (SC-009).
 *   3. A missing file is a normal empty state, not an error. So is a corrupt one:
 *      nothing here is authoritative, so the only safe reading of damaged bytes is
 *      no reading at all.
 *
 * No `electron` import. The user-data directory arrives as an argument, so every
 * behaviour here is exercisable in a bare node test (Principle IV, Principle VIII),
 * and all state lives in the closure `createCache` returns rather than in a module
 * variable.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorkItem } from '@core/model/observed.js';

/** The on-disk cache schema. Bumping it makes every older tree disposable. */
export const CACHE_SCHEMA_VERSION = 'v1';

/**
 * The directory this application's cache lives in, under the user-data directory.
 *
 * **Not `cache`.** Electron keeps Chromium's own HTTP cache at `<userData>/Cache`,
 * and Windows and macOS filesystems are case-insensitive — so `cache` and `Cache`
 * are the same directory. Sharing it meant this module treating Chromium's
 * `Cache_Data` as an unrecognised version of *our* cache and trying to delete it.
 * That failed with EPERM because Chromium holds those files open, which aborted
 * the first reconciliation and left the application showing no repositories; had
 * the timing differed it would have succeeded and corrupted Electron's state
 * instead.
 *
 * Other reserved names in the same directory include `Code Cache`, `GPUCache`,
 * `DawnCache`, `Network`, `Local Storage`, and `Session Storage`. A distinct,
 * clearly-owned name is the only way to be sure of avoiding all of them.
 */
export const CACHE_DIRECTORY = 'sdlc-cache';

/** Our version directories, and nothing else, look like this. */
const VERSION_DIRECTORY = /^v\d+$/;

export interface Cache {
  readItems(repositoryId: string): Promise<WorkItem[]>;
  writeItems(repositoryId: string, items: readonly WorkItem[]): Promise<void>;
  forgetRepository(repositoryId: string): Promise<void>;
  /** Deletes the whole cache tree. A supported recovery path (FR-038). */
  clear(): Promise<void>;
  /** `<userData>/sdlc-cache/v1`. What `createTransitionLog` and `createConversationStore` take. */
  readonly root: string;
}

export function createCache(userDataDir: string): Cache {
  const cacheDir = path.join(userDataDir, CACHE_DIRECTORY);
  const root = path.join(cacheDir, CACHE_SCHEMA_VERSION);
  const itemsDir = path.join(root, 'items');
  const transitionsDir = path.join(root, 'transitions');

  /**
   * Opening is lazy and memoised rather than done in the factory: Principle VIII
   * forbids import-time side effects, and a synchronous factory cannot await. The
   * promise is closure state, so two caches over two directories never interfere.
   */
  let opened: Promise<void> | null = null;
  const open = (): Promise<void> => {
    opened ??= (async () => {
      await discardForeignVersions(cacheDir);
      await mkdir(itemsDir, { recursive: true });
    })();
    return opened;
  };

  const itemsFile = (repositoryId: string): string =>
    path.join(itemsDir, `${encodeSegment(repositoryId)}.json`);

  return {
    root,

    async readItems(repositoryId: string): Promise<WorkItem[]> {
      await open();
      const raw = await readTextOrNull(itemsFile(repositoryId));
      if (raw === null) return [];
      const parsed = parseJsonOrNull(raw);
      if (!Array.isArray(parsed)) return [];
      // Our own serialisation, read back. Anything that is not an array of records
      // was discarded above rather than coerced; the cache is rebuildable, so a
      // damaged file costs one reconciliation, never a wrong answer (Principle VI).
      return parsed as WorkItem[];
    },

    async writeItems(repositoryId: string, items: readonly WorkItem[]): Promise<void> {
      await open();
      await writeFileAtomic(itemsFile(repositoryId), JSON.stringify(items));
    },

    /**
     * Drops everything keyed by repository. Conversations are keyed by item rather
     * than by repository and so are not reachable from here; they are pruned with
     * the whole tree by `clear()`.
     */
    async forgetRepository(repositoryId: string): Promise<void> {
      await open();
      const segment = encodeSegment(repositoryId);
      await rm(itemsFile(repositoryId), { force: true });
      await rm(path.join(transitionsDir, `${segment}.jsonl`), { force: true });
    },

    async clear(): Promise<void> {
      await rm(cacheDir, { recursive: true, force: true });
      // Re-arm the lazy open so the next call recreates the tree instead of
      // writing into a directory that is no longer there.
      opened = null;
    },
  };
}

/**
 * An interrupted write must not leave a half-file. Write a sibling temp file, then
 * rename: `rename` replaces the destination atomically on every platform this app
 * targets, so a reader sees either the previous bytes or the new ones.
 *
 * Exported because registry, secrets, transitions, and conversations all owe the
 * same guarantee and this module is the one that owns filesystem mechanics.
 */
export async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, 'utf8');
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Reads a UTF-8 file, treating absence as the empty state rather than an error. */
export async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Parses JSON without throwing. Damaged bytes are a `null`, not an exception. */
export function parseJsonOrNull(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const SAFE_SEGMENT_CHARACTER = /[A-Za-z0-9._-]/;

/** Names Windows refuses regardless of extension. */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * Turns an untrusted identifier — a repository id, an item key, a state id — into
 * one path segment.
 *
 * Item keys come from providers (Principle IX: untrusted producer output) and can
 * carry separators, `..`, or characters Windows refuses in a filename. Everything
 * outside `[A-Za-z0-9._-]` is percent-encoded, which makes traversal impossible and
 * keeps the common case (`PROJ-123`) readable on disk.
 */
export function encodeSegment(value: string): string {
  let encoded = '';
  for (const character of value) {
    encoded += SAFE_SEGMENT_CHARACTER.test(character)
      ? character
      : percentEncode(character);
  }
  // Windows rejects a trailing dot, and a bare `.` or `..` would escape the folder.
  while (encoded.endsWith('.')) encoded = `${encoded.slice(0, -1)}%2E`;
  // A leading `%` cannot occur in an encoded segment (an encoded byte is `%` plus
  // two hex digits), so it is an unambiguous escape for the remaining hazards.
  if (encoded.length === 0 || RESERVED_DEVICE_NAME.test(encoded)) return `%${encoded}`;
  return encoded;
}

function percentEncode(character: string): string {
  const encoded = encodeURIComponent(character);
  // `encodeURIComponent` leaves `!'()*` alone, and `*` is illegal on Windows.
  if (encoded !== character) return encoded;
  return `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * FR-038 in one function: a version directory this build does not know how to read
 * is deleted, not parsed, because everything under it is rebuildable from the
 * system of record.
 *
 * **Only entries that look like one of our own version directories are touched.**
 * The earlier version of this function deleted everything it did not recognise, on
 * the reasoning that the whole directory was ours and therefore disposable. That
 * reasoning was wrong twice over: the directory was shared with Chromium's cache
 * through a case-insensitive filename collision, and "delete what I do not
 * recognise" is the wrong default for any directory this application did not
 * create. Deleting only `v<N>` is correct even if the collision returns.
 */
async function discardForeignVersions(cacheDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === CACHE_SCHEMA_VERSION) continue;
    if (!VERSION_DIRECTORY.test(entry)) continue;
    // Best effort: something else holding a file open must not abort the boot.
    // A stale version directory left on disk costs disk space, never correctness.
    try {
      await rm(path.join(cacheDir, entry), { recursive: true, force: true });
    } catch {
      // Left in place deliberately. It is never read — only `CACHE_SCHEMA_VERSION` is.
    }
  }
}
