/**
 * T025 — the Jira provider fake.
 *
 * Behaviourally identical to every other fake: all of the behaviour lives in
 * `base.ts`, and this file contributes only a `kind`, an advisory fault
 * vocabulary, and a factory name (provider-interface.md §3).
 */

import type { FakeControls, FakeFault, FakeOptions } from './base.js';
import { createFakeProvider } from './base.js';
import type { Provider } from '../contract.js';

export const JIRA_FAKE_KIND = 'jira';

/**
 * The faults a hosted tracker would really produce — the filesystem set plus the
 * two that only a credentialed, quota-bearing host can raise. Advisory only:
 * `setFault` accepts every `FakeFault` on every fake, so the engine's error paths
 * are exercised identically across all three (Principle IV).
 */
export const jiraFakeFaults: readonly FakeFault[] = [
  'none',
  'unreachable',
  'unauthenticated',
  'rate_limited',
  'missing_artifact',
  'gate_unevaluated',
  'not_configured',
];

export function createJiraFake(options: FakeOptions): Provider & FakeControls {
  return createFakeProvider(JIRA_FAKE_KIND, options);
}
