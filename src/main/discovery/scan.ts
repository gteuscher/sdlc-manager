/**
 * T037, T038 — finding the SDLC packages installed on this machine.
 *
 * FR-042: an SDLC package is a directory carrying a readable `sdlc.yaml`. That is
 * the whole definition. Roots hold packages, so each root is scanned one level
 * deep, and a root that itself carries a manifest is a package in its own right
 * (a repository checked out directly as a package location).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A LIFECYCLE IS NEVER INFERRED FROM SKILL PROSE.
 *
 * This module reads exactly one file per package: `sdlc.yaml`. It does not open
 * `skills/`, `agents/`, `commands/`, `README`, `plugin.json`, or any other file
 * in the package, and it must never be changed to. A state that an agent's
 * prompt text describes but the manifest does not declare DOES NOT EXIST
 * (Constitution Principle II, FR-041; spec.md Edge Cases, "a package's manifest
 * disagrees with its own skills").
 *
 * The consequence is deliberate and is the behaviour FR-045 asks for: a package
 * that executes a lifecycle but never enumerates it is listed as *unsupported*,
 * naming the `sdlc.yaml` it is missing, rather than having its stages guessed.
 * `looksLikeAgentPackage` below tests only for the EXISTENCE of platform marker
 * entries so that such a package can be reported at all; it never reads one, and
 * nothing it finds contributes a state, a gate, or an artifact.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here throws. Package discovery runs at startup, and one unreadable
 * directory — a permission-denied plugin folder, a broken symlink — must not
 * take out the list (Principle X: the application still opens).
 */

import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readManifest } from '@core/manifest/parse.js';
import type { ManifestProblem, SdlcPackage } from '@core/model/declared.js';

/** The one file this module reads. See the header. */
const MANIFEST_FILENAME = 'sdlc.yaml';

/** Environment variable overriding where packages are looked for. Path-delimited. */
const ROOTS_ENV_VAR = 'SDLC_PACKAGE_PATHS';

/**
 * `version` for a package whose manifest could not be read. The package's own
 * version is declared *in* the manifest, so when the manifest is unusable there
 * is nothing to report but the absence itself (FR-043, FR-047).
 */
const UNKNOWN_VERSION = 'unknown';

/**
 * `contractVersion` for a package whose manifest could not be read. Zero is not a
 * contract version any manifest may declare (§6 requires a positive integer), so
 * it reads unambiguously as "not established".
 */
const UNKNOWN_CONTRACT_VERSION = 0;

/**
 * Entries whose mere presence marks a directory as an agent package. Used only to
 * decide whether a manifest-less directory is worth reporting as unsupported.
 * NONE OF THESE IS EVER OPENED — see the header.
 */
const AGENT_PACKAGE_MARKERS: readonly string[] = [
  path.join('.claude-plugin', 'plugin.json'),
  'plugin.json',
  'skills',
  'agents',
  'commands',
];

export interface PackageRootsInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

/** Where SDLC packages live on this machine. Overridable by SDLC_PACKAGE_PATHS (path-delimited). */
export function defaultPackageRoots(input?: PackageRootsInput): string[] {
  const env = input?.env ?? process.env;
  const override = env[ROOTS_ENV_VAR];

  if (override !== undefined && override.trim() !== '') {
    // `path.delimiter`, not a hardcoded separator: ';' on Windows, ':' elsewhere
    // (Principle I — path handling is platform-neutral).
    return override
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
  }

  const home = input?.homeDir ?? os.homedir();
  // Defaults rather than configuration: the agent package locations a developer
  // machine already has, plus one runtime-neutral location for packages that
  // belong to no particular agent vendor. Any other location is supplied through
  // the environment variable above rather than by editing this list.
  return [
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.sdlc', 'packages'),
  ];
}

// ── Error inspection, without `any` ──────────────────────────────────────────

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return '';
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when the path simply is not there, as opposed to being there and unreadable. */
function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

// ── Building a package record ────────────────────────────────────────────────

function unsupportedPackage(directory: string, problem: ManifestProblem): SdlcPackage {
  // With no manifest there is no declared `id`, so the directory name stands in.
  // It is a display fallback, not an identity claim: a package in this shape can
  // never be associated with a repository (spec.md scenario 5).
  const fallbackId = path.basename(directory);
  return {
    id: fallbackId,
    name: fallbackId,
    version: UNKNOWN_VERSION,
    contractVersion: UNKNOWN_CONTRACT_VERSION,
    path: directory,
    definition: null,
    problem,
  };
}

/**
 * Whether a manifest-less directory is an agent package at all.
 *
 * Existence checks only. See the header: nothing found here is read, and nothing
 * found here contributes any part of a lifecycle. Its only effect is whether a
 * directory is reported as unsupported or ignored entirely.
 */
async function looksLikeAgentPackage(directory: string): Promise<boolean> {
  for (const marker of AGENT_PACKAGE_MARKERS) {
    try {
      await stat(path.join(directory, marker));
      return true;
    } catch {
      // Absent or unreadable: try the next marker.
    }
  }
  return false;
}

/** Reads one candidate directory. Returns null when it holds no `sdlc.yaml` at all. */
export async function readPackageAt(directory: string): Promise<SdlcPackage | null> {
  const manifestPath = path.join(directory, MANIFEST_FILENAME);

  let source: string;
  try {
    source = await readFile(manifestPath, 'utf8');
  } catch (error) {
    // Not there at all: not a package, and not this function's business to
    // report. `scanPackages` decides whether the directory is an agent package
    // worth listing as unsupported.
    if (isMissing(error)) return null;

    // There, but unreadable — a directory named `sdlc.yaml`, a permission
    // problem, a broken symlink. Listed, naming exactly what went wrong (FR-045).
    return unsupportedPackage(directory, {
      field: MANIFEST_FILENAME,
      message: `${manifestPath} could not be read: ${errorReason(error)}`,
    });
  }

  const result = readManifest(source);
  if (!result.ok) {
    // The manifest is never partially loaded (FR-044): an invalid one yields a
    // package with `definition: null` and the offending field named. The problem
    // is passed through verbatim — `readManifest` already carries the field and,
    // where the YAML supplies one, the line. An unsupported contract version
    // arrives here too, naming the version it found (FR-047).
    const first: ManifestProblem = result.problems[0] ?? {
      field: MANIFEST_FILENAME,
      message: `${manifestPath} is not a valid SDLC manifest`,
    };
    return unsupportedPackage(directory, first);
  }

  const manifest = result.value;
  const loaded: { -readonly [K in keyof SdlcPackage]: SdlcPackage[K] } = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    contractVersion: manifest.contractVersion,
    path: directory,
    definition: manifest.definition,
    problem: null,
  };
  if (manifest.description !== undefined) loaded.description = manifest.description;
  return loaded;
}

/** The record for a directory that is an agent package but declares no lifecycle. */
function missingManifestPackage(directory: string): SdlcPackage {
  return unsupportedPackage(directory, {
    field: MANIFEST_FILENAME,
    message:
      `${path.join(directory, MANIFEST_FILENAME)} is missing. This package declares no lifecycle ` +
      `manifest, so it is unsupported: its states are not guessed from its skills or documentation.`,
  });
}

/** Case-insensitive on Windows, where two spellings of one path are one directory. */
function dedupeKey(directory: string): string {
  const resolved = path.resolve(directory);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Scans the given roots. Any directory containing a readable `sdlc.yaml` is an available package. */
export async function scanPackages(roots: readonly string[]): Promise<SdlcPackage[]> {
  const found: SdlcPackage[] = [];
  const seen = new Set<string>();

  const add = (candidate: SdlcPackage): void => {
    const key = dedupeKey(candidate.path);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(candidate);
  };

  // One bad package never aborts the scan, and one bad root never aborts the
  // others: every step below is individually guarded.
  const consider = async (directory: string): Promise<void> => {
    let candidate: SdlcPackage | null = null;
    try {
      candidate = await readPackageAt(directory);
    } catch (error) {
      // readPackageAt is written not to throw; if it ever does, the package is
      // still listed rather than silently dropped.
      add(unsupportedPackage(directory, { field: MANIFEST_FILENAME, message: errorReason(error) }));
      return;
    }

    if (candidate !== null) {
      add(candidate);
      return;
    }

    // No `sdlc.yaml` at all. Report it only if the directory is an agent package
    // — otherwise it is an unrelated folder that happens to sit in a root.
    try {
      if (await looksLikeAgentPackage(directory)) add(missingManifestPackage(directory));
    } catch {
      // Unreadable directory: skipped.
    }
  };

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);

    // A root that itself carries a manifest is a package (a package directory
    // registered directly, rather than a folder of packages).
    await consider(resolvedRoot);

    let entries: Dirent[];
    try {
      entries = await readdir(resolvedRoot, { withFileTypes: true });
    } catch {
      // A root that does not exist or cannot be listed is skipped, not an error:
      // most machines will not have all of the default locations.
      continue;
    }

    // Sorted so the same machine always produces the same order; `readdir` does
    // not promise one.
    const children = entries
      // A symlinked package directory is a normal way to install one, so a
      // symlink is a candidate too.
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const name of children) {
      await consider(path.join(resolvedRoot, name));
    }
  }

  return found;
}
