/**
 * T098 — a package the dashboard cannot support is listed, and named, and never
 * guessed at (FR-045, FR-047, Constitution Principle II).
 *
 * The hard line this suite defends is the second half of Principle II:
 *
 *   "This application MUST NOT infer any part of a lifecycle from the prose of an
 *    agent's skills, prompts, commands, or documentation: a state that is
 *    described but not declared does not exist."
 *
 * That is a rule about a temptation, not about a bug. A package with no manifest
 * still ships a skill file describing its stages in order, and parsing it would
 * make the dashboard look more capable on the day it shipped and wrong on every
 * day after, because prompt wording is edited freely by agent authors. So the
 * fixture generator produces exactly that package — `fixture package --omit-manifest`
 * writes a `SKILL.md` that describes the lifecycle *accurately* — and the tests
 * below assert that none of it reaches the scan result.
 *
 * The second claim is FR-045's other half: unsupported is *listed*, not dropped.
 * A package that vanishes from the list teaches the engineer nothing; one that
 * says "sdlc.yaml is missing" tells them exactly what to add.
 *
 * Everything here runs against a generated tree in the OS temp directory. No
 * network, and nothing is written inside the repository working tree.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SdlcPackage } from '@core/model/declared';
import { scanPackages } from '@main/discovery/scan';

const FIXTURE_SCRIPT = fileURLToPath(new URL('../../scripts/fixture.ts', import.meta.url));

/** One root holding several candidate package directories, as a real machine has. */
let root: string;
let packages: SdlcPackage[];

function runFixture(...args: readonly string[]): void {
  execFileSync(process.execPath, [FIXTURE_SCRIPT, ...args], { stdio: 'pipe' });
}

function found(name: string): SdlcPackage {
  const candidate = packages.find((entry) => path.basename(entry.path) === name);
  if (candidate === undefined) {
    throw new Error(
      `${name} was not listed by the scan. Listed: ${packages.map((entry) => path.basename(entry.path)).join(', ')}`,
    );
  }
  return candidate;
}

/**
 * The package record with its temp path removed, so a search for leaked
 * vocabulary cannot be confused by a random directory name.
 */
function withoutPath(pkg: SdlcPackage): string {
  return JSON.stringify({ ...pkg, path: '<elided>' });
}

/** A syntactically valid manifest, so tests can break exactly one thing in it. */
function validManifest(overrides: { sdlc?: string; version?: string } = {}): string {
  return [
    `sdlc: ${overrides.sdlc ?? '1'}`,
    'id: almanac',
    'name: Almanac',
    `version: ${overrides.version ?? '3.2.1'}`,
    'providers:',
    '  - id: ledger',
    '    kind: filesystem',
    '    state:',
    '      path: entries/{item.tag}/entry.json',
    '      field: stage',
    'ownership:',
    '  state: ledger',
    '  title: ledger',
    '  artifacts: ledger',
    'items:',
    '  unit: parcel',
    '  discover:',
    '    - provider: ledger',
    '      glob: entries/*/entry.json',
    '  identity:',
    '    correlate_on: tag',
    '    patterns:',
    '      ledger: entries/(?<tag>[A-Z]+-[0-9]+)/entry\\.json',
    'states:',
    '  - id: intake',
    '    name: Intake',
    '    maps:',
    '      ledger: [logged]',
    '  - id: settled',
    '    name: Settled',
    '    terminal: true',
    '    maps:',
    '      ledger: [closed]',
    'transitions: []',
    'repo_config: []',
    '',
  ].join('\n');
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sdlc-unsupported-'));

  // 1. The package this suite exists for: prose that describes a lifecycle
  //    perfectly, and no manifest to declare one.
  runFixture('package', path.join(root, 'prose-only'), '--omit-manifest');

  // 2. The control. Without it, "unsupported" could be the only answer this
  //    scanner knows how to give and every assertion below would be vacuous.
  runFixture('package', path.join(root, 'supported'));

  // 3. A package that hides a complete, valid manifest under the wrong filename,
  //    alongside machine-readable state lists in files that are not the manifest.
  //    Every one of these would yield a lifecycle if anything but `sdlc.yaml`
  //    were read.
  const trap = path.join(root, 'prose-trap');
  await mkdir(path.join(trap, '.claude-plugin'), { recursive: true });
  await mkdir(path.join(trap, 'skills', 'lifecycle'), { recursive: true });
  await writeFile(
    path.join(trap, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'prose-trap', version: '9.9.9', states: ['fermentation', 'bottling'] }, null, 2),
  );
  await writeFile(
    path.join(trap, 'skills', 'lifecycle', 'SKILL.md'),
    ['# Cellar lifecycle', '', '## 1. Fermentation', '## 2. Bottling', ''].join('\n'),
  );
  // A real manifest, under a name the contract does not recognise.
  await writeFile(path.join(trap, 'lifecycle.yaml'), validManifest());

  // 4. There, but unreadable: a directory where the manifest should be.
  const unreadable = path.join(root, 'unreadable-manifest');
  await mkdir(path.join(unreadable, 'sdlc.yaml'), { recursive: true });

  // 5. Not valid YAML at all.
  const malformed = path.join(root, 'malformed-yaml');
  await mkdir(malformed, { recursive: true });
  await writeFile(path.join(malformed, 'sdlc.yaml'), 'sdlc: 1\nstates: [\n  - id: intake\n');

  // 6. Valid YAML, invalid manifest: one required field removed.
  const incomplete = path.join(root, 'incomplete-manifest');
  await mkdir(incomplete, { recursive: true });
  await writeFile(
    path.join(incomplete, 'sdlc.yaml'),
    validManifest().replace('name: Almanac\n', ''),
  );

  // 7. A contract version from the future (FR-047).
  const future = path.join(root, 'future-contract');
  await mkdir(future, { recursive: true });
  await writeFile(path.join(future, 'sdlc.yaml'), validManifest({ sdlc: '99' }));

  // 8. An unrelated folder that happens to sit in a package root.
  const unrelated = path.join(root, 'not-a-package');
  await mkdir(unrelated, { recursive: true });
  await writeFile(path.join(unrelated, 'README.md'), '# notes\n');

  packages = await scanPackages([root]);
}, 120_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-045 — listed, and told what is missing
// ═════════════════════════════════════════════════════════════════════════════

describe('a package carrying no manifest (FR-045)', () => {
  it('is listed rather than silently dropped', () => {
    // Dropping it would leave the engineer looking at a package that is installed
    // and invisible, with nothing to act on.
    expect(packages.map((entry) => path.basename(entry.path))).toContain('prose-only');
  });

  it('carries no definition at all', () => {
    expect(found('prose-only').definition).toBeNull();
  });

  it('names the file that is missing, by name', () => {
    const problem = found('prose-only').problem;
    expect(problem).not.toBeNull();
    expect(problem?.field).toBe('sdlc.yaml');
    expect(problem?.message).toContain('sdlc.yaml');
    expect(problem?.message).toContain('missing');
  });

  it('says the lifecycle was not guessed, so the absence reads as a decision', () => {
    // Principle V: an error is actionable when it says what to do next. "No
    // lifecycle" invites a bug report; "no manifest, and we will not infer one"
    // invites adding the manifest.
    expect(found('prose-only').problem?.message).toMatch(/not guessed|skills|documentation/i);
  });

  it('records no states, under any name, anywhere in the package record', () => {
    const pkg = found('prose-only');
    expect(pkg.definition).toBeNull();
    expect(withoutPath(pkg)).not.toContain('"states"');
  });

  it('cannot supply what associating a repository requires (FR-043)', () => {
    // FR-043 records *which package at which version*. Both live inside the
    // manifest, so a package with no manifest has neither to offer: there is
    // nothing an association could be recorded against, and no lifecycle to
    // render if one were.
    const pkg = found('prose-only');
    expect(pkg.definition).toBeNull();
    expect(pkg.version).toBe('unknown');
    expect(pkg.contractVersion).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Principle II / FR-041 — the prose describes a lifecycle, and none of it lands
// ═════════════════════════════════════════════════════════════════════════════

describe('the lifecycle is never inferred from prose (Principle II, FR-041)', () => {
  it('the fixture really does describe its stages in prose, so this suite is not vacuous', async () => {
    const skill = await readFile(
      path.join(root, 'prose-only', 'skills', 'lifecycle', 'SKILL.md'),
      'utf8',
    );
    // The bare package's three stages, spelled out in order with their gates.
    expect(skill).toContain('Draft');
    expect(skill).toContain('Build');
    expect(skill).toContain('Ship');
    expect(skill).toMatch(/stages, in order/);
  });

  it('none of the stages described in the skill file appear in the scan result', () => {
    const serialised = withoutPath(found('prose-only'));
    for (const described of ['Draft', 'Build', 'Ship', 'draft-signed-off', 'Draft signed off']) {
      expect(serialised).not.toContain(described);
    }
  });

  it('a complete manifest under the wrong filename is still not a manifest', () => {
    // `lifecycle.yaml` in this package is valid and declares two states. Reading
    // it would be indistinguishable from reading the right file — right up until
    // a package ships two of them that disagree.
    const pkg = found('prose-trap');
    expect(pkg.definition).toBeNull();
    expect(pkg.problem?.field).toBe('sdlc.yaml');
    expect(withoutPath(pkg)).not.toContain('intake');
    expect(withoutPath(pkg)).not.toContain('settled');
  });

  it('a state list inside plugin.json contributes nothing', () => {
    // `plugin.json` is one of the markers the scanner tests for existence. A
    // marker it opened would be a marker it could learn a lifecycle from.
    const serialised = withoutPath(found('prose-trap'));
    expect(serialised).not.toContain('fermentation');
    expect(serialised).not.toContain('bottling');
    expect(serialised).not.toContain('9.9.9');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-045's other half — an unreadable or invalid manifest, each named
// ═════════════════════════════════════════════════════════════════════════════

describe('a manifest that is present but unusable', () => {
  it('lists a manifest that cannot be read, naming the path and the reason', () => {
    const pkg = found('unreadable-manifest');
    expect(pkg.definition).toBeNull();
    expect(pkg.problem?.field).toBe('sdlc.yaml');
    expect(pkg.problem?.message).toContain('could not be read');
    expect(pkg.problem?.message).toContain(path.join(pkg.path, 'sdlc.yaml'));
  });

  it('lists a manifest that is not valid YAML, and says where it broke', () => {
    // FR-044: never partially loaded. A parse error yields no definition at all,
    // and the line is what makes it fixable without a second tool.
    const pkg = found('malformed-yaml');
    expect(pkg.definition).toBeNull();
    expect(pkg.problem?.message.length ?? 0).toBeGreaterThan(0);
    expect(typeof pkg.problem?.line).toBe('number');
  });

  it('lists a manifest missing a required field, naming that field (FR-044)', () => {
    const pkg = found('incomplete-manifest');
    expect(pkg.definition).toBeNull();
    const field = pkg.problem?.field ?? '';
    expect(field.length).toBeGreaterThan(0);
    // The reason names the same field the `field` carries, so the message stands
    // alone in a list where the structured field is not rendered.
    expect(pkg.problem?.message).toContain(field);
  });

  it('loads none of a malformed manifest — no partial definition survives', () => {
    for (const name of ['malformed-yaml', 'incomplete-manifest', 'unreadable-manifest']) {
      expect(found(name).definition).toBeNull();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-047 — the contract version is not the package's version
// ═════════════════════════════════════════════════════════════════════════════

describe('an unsupported contract version (FR-047)', () => {
  it('refuses the manifest rather than reading it with the rules it knows', () => {
    expect(found('future-contract').definition).toBeNull();
  });

  it('names the contract version it found', () => {
    const problem = found('future-contract').problem;
    expect(problem?.field).toBe('sdlc');
    expect(problem?.message).toContain('99');
  });

  it('does not surface the package’s own version from a manifest it refused to load', () => {
    // FR-047 asks these two to be distinguished. The manifest declares
    // `version: 3.2.1`, but that value is only trustworthy if the rest of the
    // document was read under rules this dashboard understands — and it was not.
    const pkg = found('future-contract');
    expect(pkg.version).not.toBe('3.2.1');
    expect(pkg.version).toBe('unknown');
    expect(pkg.contractVersion).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The list stays useful around the failures
// ═════════════════════════════════════════════════════════════════════════════

describe('the scan around an unsupported package', () => {
  it('still loads the supported package in the same root (Principle III)', () => {
    // One unusable package must not cost the list. The whole point of listing an
    // unsupported package rather than failing is that the others keep working.
    const pkg = found('supported');
    expect(pkg.problem).toBeNull();
    expect(pkg.definition).not.toBeNull();
    expect(pkg.definition?.states.length ?? 0).toBeGreaterThan(0);
    expect(pkg.contractVersion).toBe(1);
    expect(pkg.version).not.toBe('unknown');
  });

  it('reports a supported package under its declared id, not its directory name', () => {
    // The fallback id an unsupported package gets is a display fallback, and this
    // is what makes that distinction observable.
    const supported = found('supported');
    expect(supported.id).not.toBe('supported');
    expect(found('prose-only').id).toBe('prose-only');
  });

  it('lists every unsupported package it found rather than stopping at the first', () => {
    const unsupported = packages
      .filter((entry) => entry.definition === null)
      .map((entry) => path.basename(entry.path))
      .sort();
    expect(unsupported).toEqual([
      'future-contract',
      'incomplete-manifest',
      'malformed-yaml',
      'prose-only',
      'prose-trap',
      'unreadable-manifest',
    ]);
  });

  it('does not list an unrelated folder that merely sits in a package root', () => {
    // FR-045 is about agent packages. Reporting every folder on the machine as an
    // unsupported package would bury the ones that matter.
    expect(packages.map((entry) => path.basename(entry.path))).not.toContain('not-a-package');
  });

  it('every listed package either has a definition or says why it has none', () => {
    // There is no third state. A package with neither would render as an empty
    // lifecycle, which is the silent failure Principle II is written against.
    for (const pkg of packages) {
      const hasDefinition = pkg.definition !== null;
      const hasProblem = pkg.problem !== null && pkg.problem.message.length > 0;
      expect(hasDefinition !== hasProblem).toBe(true);
    }
  });
});
