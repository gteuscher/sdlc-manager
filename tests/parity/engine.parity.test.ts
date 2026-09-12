/**
 * Gate 5. The engine suite, run against every provider fake unmodified.
 *
 * The imports below are the entire test: `runEngineSuite` is called three times
 * with three different adapters and nothing else changes. Anything that had to
 * be special-cased per provider to make this file pass would be the leak the
 * suite exists to detect.
 */

import { describe, expect, it } from 'vitest';

import { createFilesystemFake } from '@providers/fakes/filesystem.fake';
import { createGithubFake } from '@providers/fakes/github.fake';
import { createJiraFake } from '@providers/fakes/jira.fake';

import { PROVIDER_ID, paritySeed, runEngineSuite, runPipeline } from './harness';

const fakes = [
  ['filesystem', createFilesystemFake],
  ['tracker', createJiraFake],
  ['source host', createGithubFake],
] as const;

for (const [name, factory] of fakes) {
  runEngineSuite(name, factory);
}

describe('cross-provider parity', () => {
  it('produces identical lifecycle outcomes from every adapter', async () => {
    const outcomes = await Promise.all(
      fakes.map(async ([, factory]) =>
        runPipeline(factory({ decl: { id: PROVIDER_ID, kind: 'fake', settings: {} }, seed: paritySeed() })),
      ),
    );

    const [first, ...rest] = outcomes;
    for (const other of rest) {
      // Not "each adapter works" but "the engine reached the same conclusions".
      // A difference here means the engine treated two adapters differently.
      expect(other).toEqual(first);
    }
  });

  it('covers every adapter kind the contract lists for v1.0', () => {
    expect(fakes).toHaveLength(3);
  });
});
