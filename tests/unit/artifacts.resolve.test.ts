/**
 * T085 — artifact resolution, including `{item.<field>}` locator templating
 * (FR-017, FR-019, FR-021, validation rule 14).
 *
 * This suite runs against a **generated fixture repository** parsed by the real
 * manifest reader, rather than a hand-built definition. That matters: templating
 * is the seam where a declaration written by an SDLC author meets a path on
 * someone's disk, and a hand-built definition would let the test agree with the
 * implementation about a shape no author would ever write.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readManifest } from '@core/manifest/parse';
import type { ArtifactDecl, SdlcDefinition } from '@core/model/declared';
import { createFilesystemProvider } from '@providers/filesystem/index';
import type { RepoContext } from '@providers/contract';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

let workspace: string;
let fixture: string;
let definition: SdlcDefinition;
let ctx: RepoContext;

/** Every artifact the lifecycle declares, flattened with the state that owns it. */
function declaredArtifacts(): { stateId: string; decl: ArtifactDecl }[] {
  return definition.states.flatMap((state) => state.artifacts.map((decl) => ({ stateId: state.id, decl })));
}

function provider() {
  const decl = definition.providers.find((candidate) => candidate.kind === 'filesystem');
  if (decl === undefined) throw new Error('the fixture declares no filesystem provider');
  return createFilesystemProvider({ decl });
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'sdlc-artifacts-'));
  fixture = join(workspace, 'demo');

  execFileSync(process.execPath, [join(repoRoot, 'scripts', 'fixture.ts'), 'create', fixture], {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  const manifest = readManifest(await readFile(join(fixture, 'sdlc', 'sdlc.yaml'), 'utf8'));
  if (!manifest.ok) {
    throw new Error(`the fixture manifest did not parse: ${manifest.problems.map((p) => p.message).join('; ')}`);
  }
  definition = manifest.value.definition;
  ctx = { repositoryId: 'demo', repositoryPath: fixture, definition, config: {} };
}, 60_000);

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the fixture itself is a usable subject', () => {
  it('declares artifacts to resolve', () => {
    expect(declaredArtifacts().length).toBeGreaterThan(0);
  });

  it('declares at least one templated locator, which is the thing under test', () => {
    const templated = declaredArtifacts().filter(({ decl }) => (decl.locator.path ?? '').includes('{item.'));
    expect(templated.length).toBeGreaterThan(0);
  });

  it('declares every identity field its templates reference (validation rule 14)', () => {
    // The manifest already passed `readManifest`, which enforces rule 14, so this
    // records the guarantee the rest of the suite relies on.
    const declared = new Set(definition.items.identity.fields);
    for (const { decl } of declaredArtifacts()) {
      for (const match of (decl.locator.path ?? '').matchAll(/\{item\.([A-Za-z0-9_]+)\}/g)) {
        expect(declared).toContain(match[1]);
      }
    }
  });
});

describe('locator templating resolves against the item', () => {
  it('substitutes {item.key} and reads the file that results', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown' && (decl.locator.path ?? '').includes('{item.'));
    expect(markdown).toBeDefined();

    const content = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-101');
    expect(content.ok).toBe(true);
    if (!content.ok) return;
    expect(content.value.content.length).toBeGreaterThan(0);
  });

  it('resolves a different item to a different file', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown' && (decl.locator.path ?? '').includes('{item.'));
    const first = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-101');
    const second = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-102');

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // The locator is one declaration; the item is what makes it two paths.
    expect(first.value.locator).not.toBe(second.value.locator);
  });

  it('reports the resolved locator for display, with the template already substituted', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown' && (decl.locator.path ?? '').includes('{item.'));
    const content = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-101');
    expect(content.ok).toBe(true);
    if (!content.ok) return;

    expect(content.value.locator).toContain('DEMO-101');
    expect(content.value.locator).not.toContain('{item.');
  });

  it('attributes the artifact to its provider and stamps when it was reconciled (FR-018)', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown');
    const content = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-101');
    expect(content.ok).toBe(true);
    if (!content.ok) return;

    expect(content.value.provider).toBe(markdown!.decl.provider);
    expect(content.value.reconciledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('refuses a template naming a field the item does not carry, rather than reading a mangled path', async () => {
    const invented: ArtifactDecl = {
      id: 'invented',
      name: 'Invented',
      kind: 'markdown',
      provider: definition.ownership.artifacts,
      locator: { provider: definition.ownership.artifacts, path: 'docs/items/{item.sprint}/notes.md' },
      required: false,
    };
    const content = await provider().readArtifact(ctx, invented, 'DEMO-101');

    // Silently leaving `{item.sprint}` in the path would produce a confusing
    // not-found; naming the unresolved field is the actionable error (Principle V).
    expect(content.ok).toBe(false);
    if (content.ok) return;
    expect(content.message).toContain('sprint');
  });
});

describe('a missing artifact is reported, not hidden (FR-019)', () => {
  it('returns a typed not_found rather than empty content', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown' && (decl.locator.path ?? '').includes('{item.'));
    const content = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-NOSUCH');

    expect(content.ok).toBe(false);
    if (content.ok) return;
    expect(content.reason).toBe('not_found');
  });

  it('names what is missing, so the slot can say what failed and why', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown' && (decl.locator.path ?? '').includes('{item.'));
    const content = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-NOSUCH');
    expect(content.ok).toBe(false);
    if (content.ok) return;
    expect(content.message).toContain('DEMO-NOSUCH');
  });

  it('leaves every other artifact in the state readable', async () => {
    // One unreadable artifact must not remove the rest of the tab.
    const deleted = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown' && (decl.locator.path ?? '').includes('{item.'));
    const survivor = declaredArtifacts().find(({ decl }) => decl.kind === 'test-results');
    expect(survivor).toBeDefined();

    const missing = await provider().readArtifact(ctx, deleted!.decl, 'DEMO-NOSUCH');
    const present = await provider().readArtifact(ctx, survivor!.decl, 'DEMO-103');

    expect(missing.ok).toBe(false);
    expect(present.ok).toBe(true);
  });
});

describe('content crosses inert (ipc-surface.md rule 6, FR-020)', () => {
  it('returns markdown as text, never as HTML for injection', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown');
    const content = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-101');
    expect(content.ok).toBe(true);
    if (!content.ok) return;

    // The renderer parses markdown to React elements; a provider that pre-rendered
    // HTML would reintroduce the injection path the design removes.
    expect(content.value.content).not.toMatch(/^\s*<(!doctype|html|body|div)/i);
  });

  it('returns test results as structured text the renderer can summarise', async () => {
    const results = declaredArtifacts().find(({ decl }) => decl.kind === 'test-results');
    const content = await provider().readArtifact(ctx, results!.decl, 'DEMO-103');
    expect(content.ok).toBe(true);
    if (!content.ok) return;

    const parsed = JSON.parse(content.value.content) as { outcome?: string; cases?: unknown[] };
    expect(parsed.outcome).toBeDefined();
    expect(Array.isArray(parsed.cases)).toBe(true);
  });
});

describe('a very large artifact does not make the view unusable (FR-021)', () => {
  it('truncates, and says so, rather than returning unbounded content', async () => {
    const markdown = declaredArtifacts().find(({ decl }) => decl.kind === 'markdown' && (decl.locator.path ?? '').includes('{item.'));
    const path = (markdown!.decl.locator.path ?? '').replace('{item.key}', 'DEMO-101');
    const target = join(fixture, path);

    await writeFile(target, `# Enormous\n\n${'lorem ipsum '.repeat(120_000)}`, 'utf8');

    const content = await provider().readArtifact(ctx, markdown!.decl, 'DEMO-101');
    expect(content.ok).toBe(true);
    if (!content.ok) return;

    expect(content.value.truncated).toBe(true);
    expect(content.value.byteLength).toBeGreaterThan(content.value.content.length);
  });

  it('reports byteLength honestly for a small artifact, and does not claim truncation', async () => {
    const results = declaredArtifacts().find(({ decl }) => decl.kind === 'test-results');
    const content = await provider().readArtifact(ctx, results!.decl, 'DEMO-103');
    expect(content.ok).toBe(true);
    if (!content.ok) return;

    expect(content.value.truncated).toBe(false);
    expect(content.value.byteLength).toBeGreaterThan(0);
  });
});
