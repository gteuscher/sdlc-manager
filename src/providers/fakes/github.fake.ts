/**
 * T026 — the GitHub provider fake.
 *
 * Behaviourally identical to every other fake: all of the behaviour lives in
 * `base.ts`, and this file contributes only a `kind`, an advisory fault
 * vocabulary, and a factory name (provider-interface.md §3).
 */

import type { FakeControls, FakeFault, FakeOptions } from './base.js';
import { createFakeProvider } from './base.js';
import type { Provider } from '../contract.js';

export const GITHUB_FAKE_KIND = 'github';

/**
 * The faults a hosted check service would really produce — the same set as the
 * tracker fake, since both are credentialed and rate limited. Advisory only:
 * `setFault` accepts every `FakeFault` on every fake, so the engine's error paths
 * are exercised identically across all three (Principle IV).
 */
export const githubFakeFaults: readonly FakeFault[] = [
  'none',
  'unreachable',
  'unauthenticated',
  'rate_limited',
  'missing_artifact',
  'gate_unevaluated',
  'not_configured',
];

export function createGithubFake(options: FakeOptions): Provider & FakeControls {
  return createFakeProvider(GITHUB_FAKE_KIND, options);
}
