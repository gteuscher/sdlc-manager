/**
 * The built application reads its environment.
 *
 * ## Why this test exists
 *
 * This is a regression guard for a bug that passed every other gate. The main
 * process was built by Vite without `build.ssr`, so Vite treated it as a browser
 * bundle and **statically replaced `process.env` with `{}`**:
 *
 *     var define_process_env_default = {};
 *     function defaultPackageRoots(input) {
 *       const env = define_process_env_default;   // always empty
 *
 * Nothing failed loudly. TypeScript was clean, lint was clean, 612 unit tests
 * passed, the cold-start smoke test passed, and the size budgets passed — because
 * every one of them exercises the *source*, and the defect was in the *build*.
 * The symptoms reached the user instead: `SDLC_PACKAGE_PATHS` was ignored so no
 * lifecycle was ever discovered, and `SDLC_RENDERER_URL` was ignored so
 * `npm run dev` silently served the last built renderer rather than the dev
 * server, which looked exactly like a stale cache.
 *
 * The lesson generalises past this one config flag: **a build step can break a
 * program that every source-level check says is correct.** So the assertion here
 * is deliberately end-to-end — launch the real binary, set a variable, and ask the
 * running application what it saw.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', new URL('..', import.meta.url))).replace(/[\\/]+$/, '');
const mainEntry = join(repoRoot, 'dist', 'main.cjs');

let userData: string;
let app: ElectronApplication;

test.beforeAll(async () => {
  expect(existsSync(mainEntry), `${mainEntry} is missing — run "npm run build" first.`).toBe(true);

  userData = await mkdtemp(join(tmpdir(), 'sdlc-env-'));
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      // This repository carries its own lifecycle at `.specify/sdlc.yaml`, so it
      // is a package root — and `.claude` beside it is an agent package with no
      // manifest, which gives both the supported and unsupported cases at once.
      SDLC_PACKAGE_PATHS: repoRoot,
      NODE_ENV: 'production',
    },
  });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
});

test('the main process can read its own environment at all', async () => {
  const seen = await app.evaluate(() => process.env['SDLC_PACKAGE_PATHS'] ?? '(unset)');
  // If this is '(unset)', `process.env` was inlined away at build time.
  expect(seen).toBe(repoRoot);
});

test('discovery searches the directories the environment names, not the defaults', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const roots = await window.evaluate(async () => {
    const bridge = (globalThis as unknown as { dashboard?: { packageSearchPaths(): Promise<string[]> } }).dashboard;
    return bridge === undefined ? null : bridge.packageSearchPaths();
  });

  expect(roots).toEqual([repoRoot]);
});

test('a lifecycle in those directories is actually found', async () => {
  const window = await app.firstWindow();

  const packages = await expect
    .poll(
      async () =>
        window.evaluate(async () => {
          const bridge = (globalThis as unknown as {
            dashboard?: { listPackages(): Promise<{ id: string; supported: boolean }[]> };
          }).dashboard;
          return bridge === undefined ? [] : bridge.listPackages();
        }),
      { timeout: 20_000 },
    )
    .not.toHaveLength(0)
    .then(async () =>
      window.evaluate(async () => {
        const bridge = (globalThis as unknown as {
          dashboard?: { listPackages(): Promise<{ id: string; supported: boolean }[]> };
        }).dashboard;
        return bridge === undefined ? [] : bridge.listPackages();
      }),
    );

  expect(packages.find((pkg) => pkg.id === 'speckit')?.supported).toBe(true);
});

test('a package carrying no manifest is found and reported unsupported (FR-045)', async () => {
  const window = await app.firstWindow();

  const packages = await window.evaluate(async () => {
    const bridge = (globalThis as unknown as {
      dashboard?: { listPackages(): Promise<{ id: string; supported: boolean; problem: string | null }[]> };
    }).dashboard;
    return bridge === undefined ? [] : bridge.listPackages();
  });

  // `.claude` holds the Spec Kit skill files, which describe the lifecycle in
  // prose. It must be listed, and it must be unsupported: a described state does
  // not exist (Principle II).
  const prose = packages.find((pkg) => pkg.id === '.claude');
  expect(prose?.supported).toBe(false);
  expect(prose?.problem ?? '').toMatch(/sdlc\.yaml/);
});
