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
 *
 * ── T043: the same measurement, with both panes rendered ────────────────────
 *
 * 003 turned the list into one pane of a two-pane workbench, and SC-005 restates
 * SC-008's load for that arrangement: 200+ items **with a detail open beside
 * them**, not the list alone. research.md §8 predicted no change — the rail
 * renders the same rows, and the new cost is one item's detail — and recorded
 * that this is worth re-measuring rather than assuming, because the prediction is
 * about a narrower column, a lazily-loaded chunk, and a second subtree of live
 * queries, none of which the list-only figure covers.
 *
 * So the budget is now measured twice: once as it always was, and once after an
 * item has been selected. The original tests are untouched — the list-alone
 * figure is still the baseline the two-pane figure is meaningful against, and
 * losing it would leave a regression with nothing to be a regression from.
 *
 * The two-pane measurement is a *reachability* budget, not a render benchmark.
 * What it asserts is that with the detail open, the attention state is still on
 * screen and still agrees with the list inside `ATTENTION_BUDGET_MS`. It cannot
 * claim the engineer reads it in ten seconds; that stays a human observation.
 *
 * ── T040: the same measurement, with finished work included ─────────────────
 *
 * 004 took work its lifecycle calls finished *out* of this list and put it behind
 * a control, which means the figure measured above is no longer the longest list
 * the engineer can be looking at. SC-007 restates the load for the long one: 200+
 * items across 3+ repositories **with finished work included**, and identifying
 * what needs the engineer still under ten seconds. So the measurement is extended
 * rather than replaced — the bounded list stays the baseline, and the unbounded
 * one is measured against it.
 *
 * research.md §8 predicted the answer and named why, and the prediction is worth
 * asserting rather than trusting, because it is the entire reason no pagination
 * was built: **a terminal state never raises attention**, so every finished item
 * sorts below every item needing input. Including finished work lengthens the
 * list *downward*, away from the thing being looked for. That is checkable
 * directly — the last row needing attention precedes the first finished one, no
 * finished row is itself flagged, and the attention count does not move when the
 * list grows — and if it ever stopped being true, the budget would be the second
 * thing to fail rather than the first.
 *
 * It runs last, after a detail has been opened, so it is the heaviest arrangement
 * the application offers: both panes rendered *and* the unbounded list. Its
 * baseline is therefore the two-pane figure immediately above it, taken from the
 * same window a moment earlier, which is the only comparison that isolates the
 * one variable it changes.
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

// ── T043 — the same load, with both panes rendered (SC-005) ─────────────────
// Deliberately last in the file: it is the only test here that changes what the
// application is showing, and every measurement above is of the list alone.

test('what needs me is still reachable within the budget with a detail open (SC-005)', async () => {
  const window = await app.firstWindow();

  // The two-pane arrangement is the subject. A narrow window shows one pane, and
  // the measurement would silently be the list-alone one again.
  await expect(window.locator('.workbench')).toHaveAttribute('data-narrow', 'false');

  const rows = window.locator('.items__list > li');
  await expect.poll(async () => rows.count(), { timeout: ATTENTION_BUDGET_MS * 3 }).toBeGreaterThanOrEqual(200);
  const before = await rows.count();

  // Open a detail beside the list. The first selection is the expensive one: it
  // is where the lazily-loaded detail chunk is fetched, so it is the selection
  // worth measuring after.
  const target = rows.first();
  const key = (await target.locator('.row__key').innerText()).trim();
  await target.locator('.row__link').click();

  const detail = window.getByRole('main', { name: 'Item detail' });
  await expect(detail.locator('.detail__key')).toHaveText(key, { timeout: ATTENTION_BUDGET_MS * 3 });

  // FR-004 as a precondition of the measurement rather than as its subject: a
  // budget met by a workbench that had dropped half its rows would be worthless.
  expect(await rows.count(), 'opening a detail changed how many rows the list holds').toBe(before);

  const started = Date.now();

  // The same question SC-001 asks, asked again with the detail rendered: what is
  // waiting on me, without opening anything further.
  const count = window.locator('.attention-count');
  await expect(count.first()).toBeVisible({ timeout: ATTENTION_BUDGET_MS });
  const countText = await count.first().innerText();
  const marked = await rows.locator('.attention').count();
  expect(countText, 'the count and the marked rows disagree with a detail open').toContain(
    String(marked),
  );

  const elapsed = Date.now() - started;
  expect(
    elapsed,
    `attention state took ${elapsed}ms to become readable with both panes rendered`,
  ).toBeLessThan(ATTENTION_BUDGET_MS);
});

// ── T040 — the same load again, unbounded (SC-007) ──────────────────────────
// Last, and dependent on the test above having left a detail open: this is the
// heaviest thing the application renders, and its baseline is the bounded list
// as that test left it.

test('what needs me is still reachable with finished work included (SC-007)', async () => {
  const window = await app.firstWindow();

  const rows = window.locator('.items__list > li');
  await expect
    .poll(async () => rows.count(), { timeout: ATTENTION_BUDGET_MS * 3 })
    .toBeGreaterThanOrEqual(200);

  // The bounded list, as the engineer ordinarily has it, is the baseline. Both
  // figures are read from this window now rather than assumed from the fixture,
  // because what SC-007 compares is two views of one loaded application.
  const boundedRows = await rows.count();
  const boundedAttention = await rows.locator('.attention').count();
  expect(boundedAttention, 'the fixture seeds items needing attention').toBeGreaterThan(0);

  const control = window.getByLabel('Show finished work');
  await expect(control, 'finished work is excluded until asked for (FR-007)').not.toBeChecked();
  // `click` and then wait for the box to come back ticked, rather than `check`,
  // which asserts the new state in the same tick as the click. The control is
  // driven by the address rather than by the DOM node — the click writes the
  // query string and the box is ticked by the render that follows — so the
  // round trip through the router is exactly what has to be waited for.
  await control.click();
  await expect(control).toBeChecked();

  // The filter is the address (Principle XIII), so this list is a link someone
  // could have been sent — the same state, reached without touching the control.
  expect(window.url(), 'including finished work left no trace in the address').toContain(
    'finished=1',
  );

  const started = Date.now();

  // Asking for finished work is a different request, so the list is refetched;
  // what must come back is a list at least as long as the bounded one, never a
  // shorter one.
  await expect
    .poll(async () => rows.count(), { timeout: ATTENTION_BUDGET_MS * 3 })
    .toBeGreaterThanOrEqual(boundedRows);

  // The same question SC-001 asks, asked of the longest list the engineer can be
  // shown: what is waiting on me, without opening anything further.
  const count = window.locator('.attention-count');
  await expect(count.first()).toBeVisible({ timeout: ATTENTION_BUDGET_MS });

  // One pass over the rendered rows rather than two locator calls per row: at
  // this volume the round trips would themselves consume the budget being
  // measured, which would make the measurement a measurement of the test.
  const shape = await rows.evaluateAll((nodes) =>
    nodes.map((node) => ({
      finished: node.classList.contains('row--finished'),
      flagged: node.querySelector('.attention') !== null,
    })),
  );

  const marked = shape.filter((row) => row.flagged).length;
  const countText = await count.first().innerText();
  expect(countText, 'the count and the marked rows disagree with finished work shown').toContain(
    String(marked),
  );

  const elapsed = Date.now() - started;
  expect(
    elapsed,
    `attention state took ${elapsed}ms to become readable with finished work included`,
  ).toBeLessThan(ATTENTION_BUDGET_MS);

  // ── research.md §8's claim, checked rather than assumed ───────────────────

  expect(shape.length, 'including finished work shortened the list').toBeGreaterThanOrEqual(
    boundedRows,
  );

  const finished = shape.filter((row) => row.finished).length;
  expect(
    finished,
    'the fixture seeds one item in the terminal state per repository, so the longer list must be longer',
  ).toBe(shape.length - boundedRows);
  expect(finished, 'nothing finished came back, so SC-007 measured the bounded list again').toBeGreaterThan(
    0,
  );

  // A terminal state never raises attention (`attention.ts`), so the count the
  // engineer reads is the same number it was before the list grew. This is the
  // property the whole "no pagination" decision rests on.
  expect(marked, 'including finished work changed how much is waiting on the engineer').toBe(
    boundedAttention,
  );
  expect(
    shape.filter((row) => row.finished && row.flagged),
    'a finished item is asking for the engineer, which no terminal state may do',
  ).toHaveLength(0);

  // And the growth is downward: the last row needing input precedes the first
  // finished one, so the longer list grows away from what is being looked for.
  const lastFlagged = shape.reduce((last, row, index) => (row.flagged ? index : last), -1);
  const firstFinished = shape.findIndex((row) => row.finished);
  expect(
    firstFinished,
    'a finished item is sitting above something waiting on the engineer',
  ).toBeGreaterThan(lastFlagged);
});
