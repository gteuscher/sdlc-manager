/**
 * T117 — gate 8, the packaged-build cold launch.
 *
 * The constitution's Principle I promises that "a fresh clone MUST reach a
 * running application through a documented install step followed by a single
 * documented start command", and that the application "MUST start with zero
 * third-party credentials configured". Both are claims about the *built*
 * artifact, which no unit test can make: this is the only test that runs the
 * real thing.
 *
 * It launches with an empty user-data directory and an empty package root, so
 * what it exercises is the genuine first run — no repositories, no credentials,
 * nothing configured. If the application prompts for credentials before showing
 * anything, that is a failure and not a setup step (quickstart §First run).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const root = fileURLToPath(new URL('..', new URL('..', import.meta.url)));
const mainEntry = join(root, 'dist', 'main.cjs');

let userData: string;
let packageRoot: string;
let app: ElectronApplication;

test.beforeAll(async () => {
  expect(
    existsSync(mainEntry),
    `${mainEntry} is missing — run "npm run build" before "npm run smoke" (the smoke command does this for you).`,
  ).toBe(true);

  userData = await mkdtemp(join(tmpdir(), 'sdlc-smoke-data-'));
  packageRoot = await mkdtemp(join(tmpdir(), 'sdlc-smoke-packages-'));

  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      // Zero configuration: an empty root, so no SDLC package is installed and
      // no provider is configured.
      SDLC_PACKAGE_PATHS: packageRoot,
      NODE_ENV: 'production',
    },
  });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
  await rm(packageRoot, { recursive: true, force: true });
});

test('the built application launches and paints a window', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  expect(await window.title()).not.toBe('');
});

test('it opens with zero credentials configured, showing a usable interface (SC-006, FR-035)', async () => {
  const window = await app.firstWindow();

  // Something deliberate must be on screen. A blank frame is the specific
  // failure Principle X names.
  const body = window.locator('body');
  await expect(body).not.toBeEmpty();

  const text = (await body.innerText()).trim();
  expect(text.length, 'the first run rendered no copy at all').toBeGreaterThan(0);
});

test('the renderer is hardened: no Node, no require, no process', async () => {
  const window = await app.firstWindow();

  // `nodeIntegration: false` plus `contextIsolation: true` and `sandbox: true`
  // mean none of these may exist in the page's world. This is the runtime
  // counterpart to the unit assertions in window.hardening.test.ts.
  const exposure = await window.evaluate(() => ({
    hasRequire: typeof (globalThis as Record<string, unknown>)['require'] !== 'undefined',
    hasProcess: typeof (globalThis as Record<string, unknown>)['process'] !== 'undefined',
    hasModule: typeof (globalThis as Record<string, unknown>)['module'] !== 'undefined',
    hasBridge: typeof (globalThis as Record<string, unknown>)['dashboard'] !== 'undefined',
  }));

  expect(exposure.hasRequire).toBe(false);
  expect(exposure.hasProcess).toBe(false);
  expect(exposure.hasModule).toBe(false);
  // The bridge is the renderer's entire privilege set, and it must be present.
  expect(exposure.hasBridge).toBe(true);
});

test('it reaches a first paint without an uncaught error', async () => {
  const window = await app.firstWindow();
  const errors: string[] = [];
  window.on('pageerror', (error) => errors.push(error.message));

  await window.waitForLoadState('domcontentloaded');
  expect(errors).toEqual([]);
});
