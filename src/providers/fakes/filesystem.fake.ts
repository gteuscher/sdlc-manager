/**
 * T024 — the filesystem provider fake.
 *
 * Behaviourally identical to every other fake: all of the behaviour lives in
 * `base.ts`, and this file contributes only a `kind`, an advisory fault
 * vocabulary, and a factory name. That identity is what makes `tests/parity/` a
 * coupling detector rather than a compatibility check — a behavioural difference
 * here would make a parity failure ambiguous (provider-interface.md §3).
 */

import type { FakeControls, FakeFault, FakeOptions } from './base.js';
import { createFakeProvider } from './base.js';
import type { Provider } from '../contract.js';

export const FILESYSTEM_FAKE_KIND = 'filesystem';

/**
 * The faults a local disk would really produce. Advisory only: `setFault`
 * accepts every `FakeFault` on every fake, because the engine's error paths must
 * be exercised identically across all three (Principle IV).
 *
 * A filesystem has no credential to reject and no quota to exceed, so
 * `unauthenticated` and `rate_limited` are absent here; `unreachable` stands for
 * a repository path that has gone away.
 */
export const filesystemFakeFaults: readonly FakeFault[] = [
  'none',
  'unreachable',
  'missing_artifact',
  'gate_unevaluated',
  'not_configured',
];

export function createFilesystemFake(options: FakeOptions): Provider & FakeControls {
  return createFakeProvider(FILESYSTEM_FAKE_KIND, options);
}
