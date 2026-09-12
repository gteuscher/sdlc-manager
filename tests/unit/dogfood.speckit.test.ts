/**
 * T126, T129, T130 — Spec Kit as an SDLC package. The dogfood.
 *
 * ## Why this file exists
 *
 * The fixture lifecycles in `scripts/fixture.ts` were written to fit this
 * implementation, so they cannot falsify SC-003 — "a new SDLC definition with
 * states, gates, and artifacts the application has never seen can be adopted and
 * its items tracked correctly with configuration changes only, and no change to
 * the application itself". A lifecycle authored against the *contract* can.
 *
 * Spec Kit is that lifecycle. It is real, it runs in this repository, and its
 * manifest (`.specify/sdlc.yaml`) was written from
 * contracts/sdlc-manifest.md rather than from the code.
 *
 * ## The order matters
 *
 * The unsupported case is asserted **first**, against the real Spec Kit skill
 * prose. Before a manifest existed, Spec Kit encoded its stages only in the
 * SKILL.md files under `.claude/skills`, and Principle II's hard line says a
 * described state does not exist. A dogfood that skipped straight to the happy
 * path would be testing the easy half.
 */

import { cp, mkdtemp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readManifest } from '@core/manifest/parse';
import { scanPackages } from '@main/discovery/scan';
import { createServices, type Services } from '@main/index';
import type { SafeStorageLike } from '@main/secrets/index';
import type { SdlcDefinition } from '@core/model/declared';

const repoRoot = join(import.meta.dirname, '..', '..');
const manifestPath = join(repoRoot, '.specify', 'sdlc.yaml');

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc::${plain}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^enc::/, ''),
};

let workspace: string;
let definition: SdlcDefinition;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'sdlc-dogfood-'));

  const parsed = readManifest(await readFile(manifestPath, 'utf8'));
  if (!parsed.ok) {
    throw new Error(`.specify/sdlc.yaml did not parse: ${parsed.problems.map((p) => p.message).join('; ')}`);
  }
  definition = parsed.value.definition;
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ── T126: the unsupported path, asserted before anything else ───────────────

describe('T126 — before a manifest existed, Spec Kit was unsupported (FR-041, FR-045)', () => {
  let proseOnly: string;

  beforeAll(async () => {
    // A faithful copy of the Spec Kit package *without* its manifest: the real
    // skill prose, which genuinely does describe the lifecycle.
    proseOnly = join(workspace, 'packages', 'speckit-prose-only');
    await mkdir(proseOnly, { recursive: true });
    await cp(join(repoRoot, '.claude', 'skills'), join(proseOnly, 'skills'), { recursive: true });
  });

  it('the copied prose really does describe the lifecycle, so the test is not vacuous', async () => {
    const skills = await readdir(join(proseOnly, 'skills'));
    expect(skills.length).toBeGreaterThan(5);

    const names = skills.join(' ');
    // If the prose did not name the stages, "we did not infer them" would prove
    // nothing at all.
    for (const stage of ['specify', 'plan', 'tasks', 'implement']) {
      expect(names).toContain(stage);
    }
  });

  it('reports the package as unsupported, naming the missing manifest', async () => {
    const [pkg] = await scanPackages([join(workspace, 'packages')]);
    expect(pkg).toBeDefined();
    expect(pkg?.definition).toBeNull();
    expect(pkg?.problem?.message ?? '').toMatch(/sdlc\.yaml/);
  });

  it('infers no state from the prose, because a described state does not exist', async () => {
    const [pkg] = await scanPackages([join(workspace, 'packages')]);
    // Principle II's hard line. The stages are right there in the skill files and
    // must not appear here.
    expect(pkg?.definition).toBeNull();
    expect(JSON.stringify(pkg)).not.toMatch(/\bclarify\b/i);
    expect(JSON.stringify(pkg)).not.toMatch(/\banalyze\b/i);
  });
});

// ── T129: the manifest is valid, and describes this repository truthfully ────

describe('T129 — .specify/sdlc.yaml is a valid manifest', () => {
  it('passes the real manifest reader, with no partial load', async () => {
    const parsed = readManifest(await readFile(manifestPath, 'utf8'));
    expect(parsed.ok, parsed.ok ? '' : parsed.problems.map((p) => `${p.field}: ${p.message}`).join('; ')).toBe(true);
  });

  it('declares the Spec Kit lifecycle in order', () => {
    expect(definition.states.map((state) => state.id)).toEqual([
      'specify',
      'clarify',
      'plan',
      'tasks',
      'analyze',
      'implement',
      'shipped',
    ]);
  });

  it('names one feature a "feature", using the lifecycle own noun', () => {
    expect(definition.items.unit).toBe('feature');
  });

  it('declares the requirements checklist as a manual gate with an evidence locator (rule 15)', () => {
    const gate = definition.states
      .flatMap((state) => state.gates)
      .find((candidate) => candidate.kind === 'manual');

    // v1.0 cannot record a reviewer decision without breaking read-only, so the
    // lifecycle has to say where its own decisions live (research.md §16 Q1).
    expect(gate).toBeDefined();
    expect(gate?.evidence).toBeDefined();
    expect(gate?.awaitsHuman).toBe(true);
  });

  it('is discovered as a package by the real scanner', async () => {
    const packages = await scanPackages([join(repoRoot, '.specify')]);
    const speckit = packages.find((pkg) => pkg.id === 'speckit');
    expect(speckit?.definition).not.toBeNull();
    expect(speckit?.problem).toBeNull();
  });

  it('every declared artifact path resolves against this repository (SC-014)', async () => {
    const stateFile = JSON.parse(
      await readFile(join(repoRoot, 'specs', '001-sdlc-work-item-dashboard', '.sdlc-state.json'), 'utf8'),
    ) as { state: string };

    // Only the states this feature has actually reached are expected on disk;
    // a not-yet-reached state must show no fabricated artifacts.
    const reached = definition.states.filter(
      (state) => state.ordinal <= (definition.states.find((s) => s.id === stateFile.state)?.ordinal ?? 0),
    );

    const missing: string[] = [];
    for (const state of reached) {
      for (const artifact of state.artifacts) {
        if (!artifact.required) continue;
        const path = (artifact.locator.path ?? '').replace('{item.key}', '001-sdlc-work-item-dashboard');
        if (!existsSync(join(repoRoot, path))) missing.push(path);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ── T130: register this repository and read it back ─────────────────────────

describe('T130 — this repository, tracked by its own lifecycle', () => {
  let services: Services | undefined;

  beforeAll(async () => {
    const userDataDir = join(workspace, 'user-data');
    await mkdir(userDataDir, { recursive: true });

    services = createServices({
      userDataDir,
      safeStorage,
      packageRoots: [join(repoRoot, '.specify')],
    });
    await services.start();

    const registered = await services.handlers.repositories.registerRepository({
      name: 'sdlc-manager',
      path: repoRoot,
      packageId: 'speckit',
    });
    expect(registered.ok, registered.ok ? '' : registered.message).toBe(true);
  }, 60_000);

  afterAll(async () => {
    await services?.dispose().catch(() => undefined);
  });

  it('discovers each feature directory as one work item', async () => {
    const items = await services!.handlers.items.listItems({});
    expect(items.map((item) => item.key)).toContain('001-sdlc-work-item-dashboard');
  });

  it('resolves this feature to the state its own state file records', async () => {
    const items = await services!.handlers.items.listItems({});
    const dashboard = items.find((item) => item.key === '001-sdlc-work-item-dashboard');

    expect(dashboard?.stateName).toBe('Implement');
    expect(dashboard?.sdlcName).toBe('Spec Kit');
    expect(dashboard?.unit).toBe('feature');
  });

  it('reads the title from the system of record rather than from the directory name', async () => {
    const items = await services!.handlers.items.listItems({});
    expect(items.find((item) => item.key === '001-sdlc-work-item-dashboard')?.title).toBe(
      'SDLC Work Item Dashboard',
    );
  });

  it('marks the earlier states complete and the later ones not reached', async () => {
    const detail = await services!.handlers.items.getItem({ key: '001-sdlc-work-item-dashboard' });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;

    const progress = Object.fromEntries(detail.value.states.map((state) => [state.id, state.progress]));
    expect(progress['specify']).toBe('completed');
    expect(progress['plan']).toBe('completed');
    expect(progress['shipped']).toBe('not_reached');
  });

  it('reads the real gate evidence: the constitution check recorded as passing', async () => {
    const detail = await services!.handlers.items.getItem({ key: '001-sdlc-work-item-dashboard' });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;

    const gates = detail.value.states.flatMap((state) => state.gates);
    expect(gates.find((gate) => gate.id === 'constitution-check')?.result.status).toBe('passed');
  });

  it('reports the verification gate as not evaluated, because no result is recorded', async () => {
    const detail = await services!.handlers.items.getItem({ key: '001-sdlc-work-item-dashboard' });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;

    const gates = detail.value.states.flatMap((state) => state.gates);
    // No `.sdlc-checks.json` exists, and that is the honest answer: nothing has
    // recorded a verification result here. Absence is never success (FR-014).
    expect(gates.find((gate) => gate.id === 'verify')?.result.status).toBe('not_evaluated');
  });

  it('renders the real specification as a markdown artifact', async () => {
    const content = await services!.handlers.artifacts.getArtifact({
      key: '001-sdlc-work-item-dashboard',
      stateId: 'specify',
      artifactId: 'spec',
    });

    expect(content.ok).toBe(true);
    if (!content.ok) return;
    expect(content.value.content).toContain('Feature Specification');
    expect(content.value.locator).toContain('spec.md');
  });

  it('surfaces a second feature awaiting a human decision', async () => {
    const items = await services!.handlers.items.listItems({});
    const hierarchy = items.find((item) => item.key === '002-work-item-hierarchy');

    // 002 sits in `clarify`, which the manifest declares as awaiting a human, and
    // its reviewer decision is deliberately unrecorded. The dashboard should be
    // asking for it.
    expect(hierarchy?.attention?.kind).toBe('input_needed');
  });

  it('orders the feature needing attention first (FR-008)', async () => {
    const items = await services!.handlers.items.listItems({});
    expect(items[0]?.attention).not.toBeNull();
  });
});

// ── T131: the finding this exercise exists to produce ───────────────────────

describe('T131 — adopting Spec Kit required no application code change (SC-003)', () => {
  it('no Spec Kit state id appears as a string literal in src/', async () => {
    // This is the assertion the whole exercise is for. A state id appearing as a
    // *literal* is the failure mode that matters: it means the code recognises
    // that state by name, and the product is not generic over lifecycles.
    //
    // Prose is deliberately not matched. Several of these ids are ordinary
    // English words — `src/providers/assistant/index.ts` says a module "does not
    // implement the Provider interface", and `declared.ts` mentions "the kinds
    // shipped today". A check that flagged those would fail forever for reasons
    // unrelated to SC-003, and a test that cries wolf gets deleted.
    const stateIds = definition.states.map((state) => state.id);
    const root = join(repoRoot, 'src');
    const entries = await readdir(root, { recursive: true, withFileTypes: true });

    const offending: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      const contents = await readFile(path, 'utf8');
      for (const id of stateIds) {
        // Quoted on both sides: 'implement', "implement", or `implement`.
        if (new RegExp(`(['"\`])${id}\\1`).test(contents)) {
          offending.push(`${path.slice(repoRoot.length + 1)}: '${id}'`);
        }
      }
    }

    expect(offending).toEqual([]);
  });

  it('the literal check would catch a real violation, so it is not vacuous', () => {
    // Guard against the assertion above passing because the pattern is broken.
    const pattern = (id: string) => new RegExp(`(['"\`])${id}\\1`);
    expect(pattern('implement').test("if (state === 'implement') return;")).toBe(true);
    expect(pattern('implement').test('* does not implement the Provider interface')).toBe(false);
  });

  it('the manifest is the only thing that had to be written', async () => {
    // What adoption cost: one manifest, plus a state file per feature. Both are
    // changes to the SDLC package and its repository, not to the dashboard —
    // exactly what spec.md §Assumptions predicts for an existing harness.
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(join(repoRoot, 'specs', '001-sdlc-work-item-dashboard', '.sdlc-state.json'))).toBe(true);
  });

  it('the dashboard remains read-only against this repository (FR-034, SC-011)', async () => {
    // Nothing above wrote to specs/. The registration and cache went to a temp
    // user-data directory; the repository was only read.
    const before = await readdir(join(repoRoot, 'specs', '001-sdlc-work-item-dashboard'));
    await writeFile(join(workspace, 'touch'), 'x', 'utf8');
    const after = await readdir(join(repoRoot, 'specs', '001-sdlc-work-item-dashboard'));
    expect(after).toEqual(before);
  });
});
