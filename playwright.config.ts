import { defineConfig } from '@playwright/test';

/**
 * Gate 8 — the cold-start check.
 *
 * Only the smoke suite lives here. Unit, component, and parity tests run under
 * Vitest offline; this one drives a real Electron build, so it is slower, serial,
 * and deliberately separate (research.md §13).
 */
export default defineConfig({
  testDir: './tests/smoke',
  // A cold Electron launch on a laptop is not a 30-second operation.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // One at a time: these launch a real application and share a user-data path.
  workers: 1,
  fullyParallel: false,
  // A flaky gate is worse than no gate — a retry would hide a launch failure.
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
});
