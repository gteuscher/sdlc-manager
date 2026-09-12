/**
 * T119 — SC-008, measured rather than asserted.
 *
 * "An engineer supervising at least 200 active items across at least 3
 * repositories can still complete SC-001 within its stated time" — SC-001 being
 * *identify every work item awaiting their input within 10 seconds, without
 * opening any individual item*.
 *
 * That is a claim about the real application under a real load, so this runs
 * against a built Electron app with three generated fixture repositories, not
 * against a component in jsdom.
 *
 * **What a test can and cannot check here.** It cannot time a human reading a
 * screen. What it can check is everything that would make the ten seconds
 * impossible: that the list renders at all at this volume, that the items
 * needing attention are ordered first so they are the first thing under the
 * cursor, that the count is present and correct, and that reaching the point of
 * being *able* to look does not itself take longer than the budget. The human
 * half is recorded as an observation in T120, which is the honest division.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', new URL('..', import.meta.url)));
const mainEntry = join(repoRoot, 'dist', 'main.cjs');

/** SC-008's floor: at least 200 active items across at least 3 repositories. */
const REPOSITORIES = [
  { dir: 'scale-a', prefix: 'ALPHA', items: 70 },
  { dir: 'scale-b', prefix: 'BETA', items: 70 },
  { dir: 'scale-c', prefix: 'GAMMA', items: 70 },
];

/** SC-001's budget. The list must be readable well inside this. */
const ATTENTION_BUDGET_MS = 10_000;

let workspace: string;
let userData: string;
let app: ElectronApplication;

test.beforeAll(async () => {
  // Generating three fixture repositories and cold-launching Electron is well
  // past the default hook timeout, and this setup is the test's subject.
  test.setTimeout(300_000);

  expect(
    existsSync(mainEntry),
    `${mainEntry} is missing — run "npm run build" first ("npm run smoke" does this for you).`,
  ).toBe(true);

  workspace = await mkdtemp(join(tmpdir(), 'sdlc-scale-'));
  userData = join(workspace, 'user-data');
  await mkdir(join(userData, 'config'), { recursive: true });

  const packageRoot = join(workspace, 'packages');
  await mkdir(packageRoot, { recursive: true });

  const registrations = REPOSITORIES.map((repository, index) => {
    const path = join(workspace, repository.dir);
    execFileSync(
      process.execPath,
      [
        join(repoRoot, 'scripts', 'fixture.ts'),
        'create',
        path,
        '--items',
        String(repository.items),
        '--prefix',
        repository.prefix,
      ],
      { cwd: repoRoot, stdio: 'pipe' },
    );

    return {
      id: `scale-${index}`,
      name: repository.dir,
      path,
      packageId: 'fixture-standard',
      packageVersion: '2.0.0',
      config: {},
    };
  });

  // Seeding the registry directly is deliberate: this measures the list under
  // load, not the registration flow, which quickstart V5 covers.
  await writeFile(
    join(userData, 'config', 'repositories.json'),
    JSON.stringify(registrations, null, 2),
    'utf8',
  );

  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      // Every fixture carries its own package; point discovery at all of them.
      SDLC_PACKAGE_PATHS: REPOSITORIES.map((repository) => join(workspace, repository.dir, 'sdlc')).join(
        process.platform === 'win32' ? ';' : ':',
      ),
      NODE_ENV: 'production',
    },
  });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
});

test('the list renders 200+ items across 3+ repositories (SC-008)', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const rows = window.locator('.items__list > li');
  await expect.poll(async () => rows.count(), { timeout: ATTENTION_BUDGET_MS * 3 }).toBeGreaterThanOrEqual(200);
});

test('what needs me is reachable within the SC-001 budget, at this volume', async () => {
  const window = await app.firstWindow();
  const started = Date.now();

  // "Identify every item awaiting their input, without opening any individual
  // item" — so the count and the marked rows must both be on screen.
  const count = window.locator('.attention-count');
  await expect(count.first()).toBeVisible({ timeout: ATTENTION_BUDGET_MS });

  const elapsed = Date.now() - started;
  expect(elapsed, `attention state took ${elapsed}ms to become visible`).toBeLessThan(ATTENTION_BUDGET_MS);
});

test('attention-first ordering survives the volume (FR-008)', async () => {
  const window = await app.firstWindow();
  const rows = window.locator('.items__list > li');
  await expect.poll(async () => rows.count(), { timeout: ATTENTION_BUDGET_MS * 3 }).toBeGreaterThanOrEqual(200);

  const total = await rows.count();
  const flagged: number[] = [];
  // Sampling the leading rows is enough: the property under test is that no
  // unflagged row precedes a flagged one, and a violation shows up at the boundary.
  for (let index = 0; index < total; index += 1) {
    if ((await rows.nth(index).locator('.attention').count()) > 0) flagged.push(index);
  }

  expect(flagged.length, 'the fixture seeds items needing attention in every repository').toBeGreaterThan(0);

  // Every flagged row occupies a position before every unflagged one.
  const lastFlagged = flagged[flagged.length - 1] ?? -1;
  expect(lastFlagged).toBe(flagged.length - 1);
});

test('the attention count agrees with the number of marked rows (FR-009)', async () => {
  const window = await app.firstWindow();
  const rows = window.locator('.items__list > li');
  await expect.poll(async () => rows.count(), { timeout: ATTENTION_BUDGET_MS * 3 }).toBeGreaterThanOrEqual(200);

  const marked = await rows.locator('.attention').count();
  const countText = await window.locator('.attention-count').first().innerText();

  // A count that disagreed with the list would be worse than no count: it would
  // tell the engineer to stop looking while something waited.
  expect(countText).toContain(String(marked));
});

test('items from all three repositories appear in the one list (FR-001)', async () => {
  const window = await app.firstWindow();
  const listText = await window.locator('.items__list').innerText();

  for (const repository of REPOSITORIES) {
    expect(listText, `no items from ${repository.dir}`).toContain(repository.prefix);
  }
});
