/**
 * T044 — the two-pane workbench, in the built application.
 *
 * Feature 003 turned the item list and the item detail from two pages into two
 * panes of one view. Three of its claims cannot be settled by a component test,
 * and each one is here for a different reason:
 *
 *   **Both panes exist at once (FR-001, FR-003).** jsdom renders whatever the
 *   component returns; only a real window at a real width decides whether the
 *   arrangement the shell asks for is the arrangement Chromium produces. The
 *   window is 1280 wide (`src/main/window.ts`), comfortably above the narrow
 *   threshold, so the wide two-pane arrangement is the one under test.
 *
 *   **Selecting changes only the detail (FR-004).** The mechanism is a layout
 *   route, and a layout route is a claim about mounting. Componentwise it can be
 *   asserted with a router harness; here it is asserted against the real bundle,
 *   real navigation, and the real lazily-loaded detail chunk — which is the part
 *   most able to unmount the list and the part no jsdom test loads.
 *
 *   **The collapse preference survives a restart (FR-011).** This is the only
 *   one of the three that is *impossible* anywhere else. It is a claim about a
 *   second process reading what a first process wrote: `localStorage`, keyed to
 *   the renderer's `file://` origin and stored inside Electron's user-data
 *   directory. So the test launches, collapses, quits, and launches again over
 *   the same `--user-data-dir`. Nothing short of two processes proves it.
 *
 * **What a test can and cannot check here.** It cannot judge whether the two
 * panes are *usable* side by side — that is W1 and W12 in quickstart.md, and the
 * honest home for it is a human observation. What it can check is that the
 * arrangement exists, that using one pane does not cost the other, and that the
 * one preference this feature persists is genuinely persisted rather than merely
 * held in memory for the life of a window.
 *
 * This is about arrangement, not volume, so the fixture is deliberately small.
 * `scale.spec.ts` is where 200+ items with both panes rendered is measured.
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

/** Enough rows to select one and still have a list around it. Volume is scale.spec.ts's job. */
const FIXTURE = { dir: 'workbench', prefix: 'PANE', items: 8 };

/** The key `usePaneState` persists. Named here so a rename breaks this test loudly. */
const LIST_COLLAPSED_KEY = 'sdlc.workbench.listCollapsed';

let workspace: string;
let userData: string;
let repositoryPath: string;
let app: ElectronApplication | undefined;

/**
 * Launches the built application over the shared user-data directory.
 *
 * The directory is the point of this helper: the relaunch in the last test must
 * use the *same* one, because that is where Chromium keeps the `file://` origin's
 * local storage. A fresh temp directory per launch would make the persistence
 * assertion vacuous — it would pass for an application that remembered nothing.
 */
async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      SDLC_PACKAGE_PATHS: join(repositoryPath, 'sdlc'),
      NODE_ENV: 'production',
    },
  });
}

test.beforeAll(async () => {
  // Generating a fixture and cold-launching Electron is past the default hook
  // timeout even at this size.
  test.setTimeout(180_000);

  expect(
    existsSync(mainEntry),
    `${mainEntry} is missing — run "npm run build" first ("npm run smoke" does this for you).`,
  ).toBe(true);

  workspace = await mkdtemp(join(tmpdir(), 'sdlc-workbench-'));
  userData = join(workspace, 'user-data');
  await mkdir(join(userData, 'config'), { recursive: true });

  repositoryPath = join(workspace, FIXTURE.dir);
  execFileSync(
    process.execPath,
    [
      join(repoRoot, 'scripts', 'fixture.ts'),
      'create',
      repositoryPath,
      '--items',
      String(FIXTURE.items),
      '--prefix',
      FIXTURE.prefix,
    ],
    { cwd: repoRoot, stdio: 'pipe' },
  );

  // Seeded directly, as in scale.spec.ts: the subject is the arrangement, not the
  // registration flow, which quickstart V5 covers.
  await writeFile(
    join(userData, 'config', 'repositories.json'),
    JSON.stringify(
      [
        {
          id: 'workbench-0',
          name: FIXTURE.dir,
          path: repositoryPath,
          packageId: 'fixture-standard',
          packageVersion: '2.0.0',
          config: {},
        },
      ],
      null,
      2,
    ),
    'utf8',
  );

  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
});

// ── Both panes, at once ─────────────────────────────────────────────────────

test('the built application renders both panes as named landmarks (FR-001, FR-003)', async () => {
  const window = await app!.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const shell = window.locator('.workbench');
  await expect(shell).toBeVisible();
  // The wide arrangement is the one these assertions are about; a narrow window
  // would legitimately show one pane, and the test would be measuring nothing.
  await expect(shell).toHaveAttribute('data-narrow', 'false');

  // Named landmarks rather than class names: this is what the accessibility tree
  // exposes, and FR-003 is a claim about what a screen reader can find.
  await expect(window.getByRole('complementary', { name: 'Work items' })).toBeVisible();
  await expect(window.getByRole('main', { name: 'Item detail' })).toBeVisible();

  // With nothing selected the detail pane is a deliberate "nothing" rather than a
  // blank column (FR-006, Principle X).
  await expect(window.locator('.no-selection')).toBeVisible();
});

// ── Selecting changes only the detail ───────────────────────────────────────

test('selecting an item changes the detail and leaves the list where it was (FR-004, FR-005)', async () => {
  const window = await app!.firstWindow();
  const list = window.getByRole('complementary', { name: 'Work items' });
  const detail = window.getByRole('main', { name: 'Item detail' });
  const rows = window.locator('.items__list > li');

  await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  const before = await rows.count();

  const target = rows.first();
  const key = (await target.locator('.row__key').innerText()).trim();
  await target.locator('.row__link').click();

  // The detail changed: the empty state is gone and the chosen item is open.
  await expect(detail.locator('.detail__key')).toHaveText(key, { timeout: 30_000 });
  await expect(window.locator('.no-selection')).toHaveCount(0);

  // And the list did not. "Without replacing, reloading, or repositioning the
  // list" is checked as the properties an engineer would notice losing: the pane
  // is still there, still holds every row it held, and now says which one is
  // being read.
  await expect(list).toBeVisible();
  expect(await rows.count(), 'selecting an item changed how many rows the list holds').toBe(before);
  await expect(window.locator('.items__list > li[aria-current="true"]')).toHaveCount(1);
  await expect(window.locator('.items__list > li.row--selected')).toHaveCount(1);
  await expect(rows.first()).toHaveClass(/row--selected/);
});

// ── The one preference that outlives the process ────────────────────────────

test('the collapse state survives a relaunch over the same user data (FR-011)', async () => {
  test.setTimeout(180_000);

  const first = await app!.firstWindow();
  const toggle = first.locator('button.pane-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();

  await expect(first.locator('.workbench--collapsed')).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // Collapsed, the pane still reports what is waiting (FR-009) — a rail that went
  // silent would be the one regression worth catching before a restart is even
  // considered.
  await expect(first.locator('.collapsed-rail')).toBeVisible();

  // The write reached storage before the process is asked to quit. Asserting it
  // here separates "the toggle never persisted" from "the quit lost it", which
  // are different bugs with the same symptom.
  await expect
    .poll(async () => first.evaluate((key) => window.localStorage.getItem(key), LIST_COLLAPSED_KEY))
    .toBe('true');

  await app!.close();
  app = undefined;

  // Same `--user-data-dir`, therefore the same on-disk store for the renderer's
  // `file://` origin. A different directory here would prove nothing.
  app = await launch();

  const second = await app.firstWindow();
  await second.waitForLoadState('domcontentloaded');

  await expect(second.locator('.workbench--collapsed')).toHaveCount(1);
  await expect(second.locator('button.pane-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(second.locator('.workbench__list-body')).toBeHidden();

  // Expanding again is not a fresh start: the preference is a preference, so it
  // must be writable back the other way in the restored session.
  await second.locator('button.pane-toggle').click();
  await expect(second.locator('.workbench--collapsed')).toHaveCount(0);
  await expect(second.locator('.workbench__list-body')).toBeVisible();
});
