/**
 * T027 — locator templating, path resolution, and file reads for the filesystem
 * provider.
 *
 * Two rules shape everything here:
 *
 *   1. Nothing throws. A missing file, a malformed document, an unreadable
 *      directory — each is a typed `Result` failure, because one unreadable path
 *      must not take down the rest of the dashboard (provider-interface.md rule 1).
 *
 *   2. Paths are platform-neutral (constitution Principle I). Manifest locators
 *      and displayed evidence are always POSIX; actual filesystem access always
 *      goes through `node:path`, which supplies the host separator. The two
 *      representations never mix.
 */

import { constants as fsConstants, promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type { Failure, Result } from '@core/model/result.js';
import { fail, ok } from '@core/model/result.js';

/** Directories a lifecycle never keeps work items in, and that are expensive to walk. */
const SKIPPED_DIRECTORIES: readonly string[] = ['.git', 'node_modules'];

/** A ceiling on one discovery walk, so a mis-rooted provider cannot hang the app. */
const MAX_WALKED_FILES = 20_000;

/** JSON this provider reads is item metadata; anything larger is not that. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export interface TextRead {
  readonly text: string;
  /** The file's real size, not the length of `text` (FR-021). */
  readonly byteLength: number;
  readonly truncated: boolean;
}

/** Host separators to POSIX. Display locators and glob candidates are always POSIX. */
export function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

/** `.`, `./a/`, and `a//b` all collapse; the result never starts with `./` or ends with `/`. */
export function tidyRelative(value: string): string {
  const normalised = path.posix.normalize(toPosix(value));
  if (normalised === '.' || normalised === './' || normalised === '') return '';
  const withoutLeadingDot = normalised.startsWith('./') ? normalised.slice(2) : normalised;
  return withoutLeadingDot.length > 1 && withoutLeadingDot.endsWith('/')
    ? withoutLeadingDot.slice(0, -1)
    : withoutLeadingDot;
}

/** What the engineer is shown: the path relative to the repository, in POSIX form. */
export function displayPath(root: string, relative: string): string {
  const tidyRoot = tidyRelative(root);
  const tidyPath = tidyRelative(relative);
  if (tidyRoot === '') return tidyPath;
  if (tidyPath === '') return tidyRoot;
  return `${tidyRoot}/${tidyPath}`;
}

/** The provider's root, resolved against the registered repository path. */
export function resolveRoot(repositoryPath: string, root: string): string {
  return path.resolve(repositoryPath, root);
}

/**
 * A root-relative locator to an absolute path.
 *
 * A locator that climbs out of the root is refused rather than followed: the
 * manifest declares where a lifecycle keeps its files, and reading outside that
 * is a declaration error, not a capability.
 */
export function resolveUnderRoot(rootAbsolute: string, relative: string): Result<string> {
  const target = path.resolve(rootAbsolute, tidyRelative(relative));
  const back = path.relative(rootAbsolute, target);
  if (back.startsWith('..') || path.isAbsolute(back)) {
    return fail(
      'invalid_input',
      `The locator '${toPosix(relative)}' resolves outside this provider's root directory. Locators are relative to the provider's root and may not escape it.`,
      { field: toPosix(relative) },
    );
  }
  return ok(target);
}

/**
 * Substitutes `{item.<field>}` from an item's identity fields.
 *
 * An unresolved field is a failure rather than an empty segment, because a
 * locator silently missing a path segment would read the wrong file and report
 * it confidently (Principle V).
 */
export function applyTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): Result<string> {
  const missing: string[] = [];
  const rendered = template.replace(
    /\{item\.([A-Za-z0-9_.-]+)\}/g,
    (_match: string, name: string): string => {
      const value = values[name];
      if (value === undefined || value === '') {
        missing.push(name);
        return '';
      }
      return value;
    },
  );
  const first = missing[0];
  if (first !== undefined) {
    return fail(
      'invalid_input',
      `The locator '${template}' references {item.${first}}, which this item has no value for. Declare '${first}' in items.identity so the locator can be resolved.`,
      { field: `item.${first}` },
    );
  }
  return ok(rendered);
}

/** Reads a dotted path such as `stages.spec.accepted`. Absent yields `undefined`. */
export function readDotted(source: unknown, dotted: string): unknown {
  let current: unknown = source;
  for (const segment of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** `ok` when the path is an existing, readable directory; `unreachable` naming it otherwise. */
export async function readableDirectory(absolute: string, display: string): Promise<Result<true>> {
  try {
    const stats = await fs.stat(absolute);
    if (!stats.isDirectory()) {
      return fail('unreachable', `${display} exists but is not a directory.`);
    }
    await fs.access(absolute, fsConstants.R_OK);
    return ok(true);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return fail('unreachable', `${display} does not exist.`);
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return fail('unreachable', `${display} could not be read: permission denied.`);
    }
    return fail('unreachable', `${display} could not be read (${code ?? describe(error)}).`);
  }
}

/** True only for an existing regular file. Never throws, never distinguishes why not. */
export async function fileExists(absolute: string): Promise<boolean> {
  try {
    const stats = await fs.stat(absolute);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Reads a file, capping the content at `maxBytes` and reporting the real size.
 *
 * Only `maxBytes` are ever read into memory, so a very large artifact costs a
 * bounded read rather than a whole-file load (FR-021).
 */
export async function readTextCapped(
  absolute: string,
  display: string,
  maxBytes: number,
): Promise<Result<TextRead>> {
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(absolute, 'r');
    const stats = await handle.stat();
    if (stats.isDirectory()) {
      return fail('invalid_response', `${display} is a directory, not a file.`);
    }
    const byteLength = stats.size;
    const truncated = byteLength > maxBytes;
    const length = truncated ? maxBytes : byteLength;
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, 0);
    return ok({ text: buffer.toString('utf8'), byteLength, truncated });
  } catch (error) {
    return fsFailure(error, display);
  } finally {
    if (handle !== null) await handle.close().catch(() => undefined);
  }
}

/**
 * Reads and parses a JSON document.
 *
 * A missing file is `not_found`; a document that is not JSON is
 * `invalid_response`. The two are different affordances in the UI, so they are
 * different reasons here.
 */
export async function readJson(absolute: string, display: string): Promise<Result<unknown>> {
  const read = await readTextCapped(absolute, display, MAX_JSON_BYTES);
  if (!read.ok) return read;
  if (read.value.truncated) {
    return fail(
      'invalid_response',
      `${display} is ${read.value.byteLength} bytes, larger than this provider will parse as JSON.`,
    );
  }
  try {
    return ok(JSON.parse(read.value.text));
  } catch (error) {
    return fail('invalid_response', `${display} is not valid JSON: ${describe(error)}`);
  }
}

/**
 * Every regular file under `<root>/<subDirectory>`, as root-relative POSIX paths.
 *
 * A subdirectory that cannot be read is skipped rather than fatal — one
 * permission-denied folder must not empty the item list. A missing start
 * directory yields no files, because a glob naming a folder this repository does
 * not have simply matches nothing.
 */
export async function listFiles(
  rootAbsolute: string,
  subDirectory: string,
): Promise<Result<string[]>> {
  const start = tidyRelative(subDirectory);
  const startAbsolute = start === '' ? rootAbsolute : path.resolve(rootAbsolute, start);
  const found: string[] = [];
  const queue: { absolute: string; relative: string }[] = [
    { absolute: startAbsolute, relative: start },
  ];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    const listing = await readEntries(current.absolute);
    if (!listing.ok) {
      // One unreadable folder must not empty the item list; only an unreadable
      // starting point is worth reporting.
      if (current.absolute !== startAbsolute) continue;
      if (listing.reason === 'not_found') return ok([]);
      return listing;
    }
    for (const entry of listing.value) {
      const relative = current.relative === '' ? entry.name : `${current.relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
        queue.push({ absolute: path.join(current.absolute, entry.name), relative });
        continue;
      }
      // Symbolic links are neither followed nor listed: a link cycle would make
      // the walk unbounded, and a link out of the root would read past it.
      if (!entry.isFile()) continue;
      found.push(relative);
      if (found.length >= MAX_WALKED_FILES) return ok(found.sort());
    }
  }
  return ok(found.sort());
}

async function readEntries(absolute: string): Promise<Result<Dirent[]>> {
  try {
    return ok(await fs.readdir(absolute, { withFileTypes: true }));
  } catch (error) {
    return fsFailure(error, toPosix(absolute));
  }
}

/** Maps a Node filesystem error onto the closed set of failure reasons. */
export function fsFailure(error: unknown, display: string): Failure {
  const code = errorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return fail('not_found', `${display} does not exist.`);
  }
  if (code === 'EISDIR') {
    return fail('invalid_response', `${display} is a directory, not a file.`);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return fail('unreachable', `${display} could not be read: permission denied.`);
  }
  return fail('unreachable', `${display} could not be read (${code ?? describe(error)}).`);
}

export function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
