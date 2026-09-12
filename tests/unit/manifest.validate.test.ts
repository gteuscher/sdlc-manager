/**
 * T022 — the manifest schema and all fifteen validation rules.
 *
 * Principle IV states the obligation these tests discharge: "Workflow definitions
 * are untrusted user input: every schema rule MUST have a test asserting that a
 * violating definition is rejected at runtime. TypeScript types alone do not
 * satisfy this."
 *
 * So every rule in contracts/sdlc-manifest.md §5 gets a manifest that violates it,
 * and every one of those must be rejected *naming the offending field* (FR-044).
 */

import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { readManifest, SUPPORTED_CONTRACT_VERSION } from '@core/manifest/parse';

/** A manifest that satisfies every rule. Each test below breaks exactly one thing. */
function validManifest(): Record<string, unknown> {
  return {
    sdlc: 1,
    id: 'acme-standard',
    name: 'Acme Standard SDLC',
    version: '2.3.0',
    description: 'Spec-driven lifecycle with a QA gate and a release checkpoint.',
    providers: [
      { id: 'repo', kind: 'filesystem', root: '.' },
      { id: 'tracker', kind: 'jira', project: 'ENG' },
    ],
    ownership: { state: 'tracker', title: 'tracker', assignee: 'tracker', artifacts: 'repo' },
    items: {
      unit: 'ticket',
      discover: [
        { provider: 'tracker', query: 'assignee = currentUser()' },
        { provider: 'repo', glob: 'docs/stories/*/story.md' },
      ],
      identity: {
        correlate_on: 'key',
        patterns: { repo: 'docs/stories/(?<key>[A-Z]+-[0-9]+)/story\\.md' },
      },
    },
    states: [
      {
        id: 'spec',
        name: 'Specification',
        awaits_human: false,
        maps: { tracker: ['Spec', 'In Refinement'] },
        artifacts: [
          {
            id: 'spec-doc',
            name: 'Specification',
            kind: 'markdown',
            provider: 'repo',
            path: 'docs/stories/{item.key}/spec.md',
            required: true,
          },
        ],
        gates: [
          {
            id: 'spec-approved',
            name: 'Specification approved',
            kind: 'manual',
            awaits_human: true,
            blocking: true,
            evidence: { provider: 'tracker', field: 'customfield_10042' },
          },
        ],
      },
      {
        id: 'build',
        name: 'Implementation',
        maps: { tracker: ['In Progress'] },
        artifacts: [
          { id: 'design-notes', kind: 'markdown', provider: 'repo', path: 'docs/stories/{item.key}/design.md' },
        ],
        gates: [
          {
            id: 'tests-pass',
            name: 'Automated tests pass',
            kind: 'check',
            provider: 'tracker',
            check: 'unit-tests',
            blocking: true,
            configurable: true,
          },
          {
            id: 'review-approved',
            name: 'Code review approved',
            kind: 'field',
            provider: 'tracker',
            field: 'reviewStatus',
            passes_when: { equals: 'approved' },
            blocking: true,
          },
        ],
      },
      {
        id: 'release',
        name: 'Release',
        maps: { tracker: ['Ready for Release', 'Released'] },
        terminal: true,
        gates: [],
      },
    ],
    transitions: [
      { from: 'build', to: 'spec', name: 'Sent back for re-specification' },
      { from: 'build', to: 'release', requires: ['tests-pass', 'review-approved'] },
    ],
    write_back: { transitions: false, gate_results: false },
    repo_config: [
      { key: 'providers.tracker.project', title: 'Jira project key', type: 'string', required: true },
      { key: 'gates.tests-pass.check', title: 'CI check name', type: 'string', required: false, default: 'unit-tests' },
    ],
  };
}

/** Applies a mutation to a fresh valid manifest and reads the result. */
function readMutated(mutate: (manifest: any) => void) {
  const manifest = validManifest();
  mutate(manifest);
  return readManifest(stringify(manifest));
}

/** Asserts rejection, and that some problem names the expected field. */
function expectRejectedNaming(result: ReturnType<typeof readManifest>, field: string): void {
  expect(result.ok, 'manifest should have been rejected').toBe(false);
  if (result.ok) return;
  const fields = result.problems.map((problem) => problem.field ?? '(no field)');
  expect(fields, `expected a problem naming "${field}", got: ${fields.join(', ')}`).toContain(field);
}

describe('a manifest that satisfies every rule', () => {
  it('loads, and maps the contract into the declared model', () => {
    const result = readManifest(stringify(validManifest()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe('acme-standard');
    expect(result.value.contractVersion).toBe(SUPPORTED_CONTRACT_VERSION);
    expect(result.value.definition.states.map((state) => state.id)).toEqual(['spec', 'build', 'release']);
  });

  it('derives ordinal from array position, because order alone defines a linear lifecycle', () => {
    const result = readManifest(stringify(validManifest()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.states.map((state) => state.ordinal)).toEqual([0, 1, 2]);
  });

  it('defaults every write-back flag to false, so a package must opt in explicitly', () => {
    const manifest = validManifest();
    delete manifest['write_back'];
    const result = readManifest(stringify(manifest));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.writeBack).toEqual({ transitions: false, gateResults: false, records: null });
  });

  it('defaults the display noun to "item" when the lifecycle does not name one', () => {
    const result = readMutated((manifest) => {
      delete manifest.items.unit;
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.items.unit).toBe('item');
  });

  it('defaults gate flags: blocking true, awaits_human false, configurable false', () => {
    const result = readManifest(stringify(validManifest()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gate = result.value.definition.states[1]?.gates[0];
    expect(gate?.blocking).toBe(true);
    expect(gate?.configurable).toBe(true);
    expect(result.value.definition.states[1]?.gates[1]?.awaitsHuman).toBe(false);
  });
});

describe('rule 1 — the contract version', () => {
  it('refuses a major version it does not know, naming the version it found (FR-047)', () => {
    const result = readMutated((manifest) => {
      manifest.sdlc = 99;
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('99');
    expect(result.problems[0]?.field).toBe('sdlc');
  });

  it('rejects a manifest that declares no contract version at all', () => {
    const result = readMutated((manifest) => {
      delete manifest.sdlc;
    });
    expectRejectedNaming(result, 'sdlc');
  });

  it('rejects a non-integer contract version', () => {
    const result = readMutated((manifest) => {
      manifest.sdlc = '1.0';
    });
    expectRejectedNaming(result, 'sdlc');
  });

  it('refuses before validating anything else, rather than risk misreading the rest', () => {
    // Both the version and the states are wrong. Only the version is reported.
    const result = readMutated((manifest) => {
      manifest.sdlc = 42;
      manifest.states = [];
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.field).toBe('sdlc');
  });
});

describe('rule 2 — identity fields are present and non-empty', () => {
  it.each(['id', 'name', 'version'])('rejects an empty %s', (field) => {
    const result = readMutated((manifest) => {
      manifest[field] = '';
    });
    expectRejectedNaming(result, field);
  });

  it.each(['id', 'name', 'version'])('rejects a missing %s', (field) => {
    const result = readMutated((manifest) => {
      delete manifest[field];
    });
    expectRejectedNaming(result, field);
  });
});

describe('rule 3 — states are present and their ids unique', () => {
  it('rejects an empty state list', () => {
    const result = readMutated((manifest) => {
      manifest.states = [];
    });
    expectRejectedNaming(result, 'states');
  });

  it('rejects a duplicate state id', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].id = 'spec';
    });
    expectRejectedNaming(result, 'states.1.id');
  });

  it('rejects a state id that could be confused with the unmapped sentinel', () => {
    const result = readMutated((manifest) => {
      manifest.states[0].id = ' UNMAPPED';
    });
    expect(result.ok).toBe(false);
  });
});

describe('rule 4 — gate ids are unique across the whole manifest', () => {
  it('rejects a gate id reused in another state, because transitions reference gates by id', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].gates[0].id = 'spec-approved';
      manifest.transitions[1].requires = ['review-approved'];
    });
    expectRejectedNaming(result, 'states.1.gates.0.id');
  });
});

describe('rule 5 — artifact ids are unique within their state', () => {
  it('rejects a duplicate artifact id in one state', () => {
    const result = readMutated((manifest) => {
      manifest.states[0].artifacts.push({
        id: 'spec-doc',
        kind: 'markdown',
        provider: 'repo',
        path: 'docs/stories/{item.key}/other.md',
      });
    });
    expectRejectedNaming(result, 'states.0.artifacts.1.id');
  });

  it('allows the same artifact id in a different state', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].artifacts[0].id = 'spec-doc';
    });
    expect(result.ok).toBe(true);
  });
});

describe('rule 6 — every provider reference names a declared provider', () => {
  it('rejects an artifact naming an undeclared provider', () => {
    const result = readMutated((manifest) => {
      manifest.states[0].artifacts[0].provider = 'nowhere';
    });
    expectRejectedNaming(result, 'states.0.artifacts.0.provider');
  });

  it('rejects a gate naming an undeclared provider', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].gates[0].provider = 'nowhere';
    });
    expectRejectedNaming(result, 'states.1.gates.0.provider');
  });

  it('rejects a discovery rule naming an undeclared provider', () => {
    const result = readMutated((manifest) => {
      manifest.items.discover[0].provider = 'nowhere';
    });
    expectRejectedNaming(result, 'items.discover.0.provider');
  });

  it('rejects a state map keyed by an undeclared provider', () => {
    const result = readMutated((manifest) => {
      manifest.states[0].maps = { nowhere: ['Spec'], tracker: ['In Refinement'] };
    });
    expectRejectedNaming(result, 'states.0.maps.nowhere');
  });
});

describe('rule 7 — exactly one provider owns each field (T019, Principle VI, FR-048)', () => {
  it('rejects an ownership field naming an undeclared provider', () => {
    const result = readMutated((manifest) => {
      manifest.ownership.state = 'nowhere';
    });
    expectRejectedNaming(result, 'ownership.state');
  });

  it('rejects two owners for one field — this is never a runtime tie-break', () => {
    const result = readMutated((manifest) => {
      manifest.ownership.state = ['tracker', 'repo'];
    });
    expectRejectedNaming(result, 'ownership.state');
  });

  it('rejects a manifest with no ownership block at all', () => {
    const result = readMutated((manifest) => {
      delete manifest.ownership;
    });
    expectRejectedNaming(result, 'ownership');
  });
});

describe('rule 8 — the provider owning state maps every non-terminal state', () => {
  it('rejects a non-terminal state the owning provider cannot reach', () => {
    const result = readMutated((manifest) => {
      delete manifest.states[1].maps;
    });
    expectRejectedNaming(result, 'states.1.maps.tracker');
  });

  it('allows a terminal state with no maps, since items there leave the active list', () => {
    const result = readMutated((manifest) => {
      delete manifest.states[2].maps;
    });
    expect(result.ok).toBe(true);
  });
});

describe('rule 9 — no raw value maps to more than one state (T020, FR-048)', () => {
  it('rejects an ambiguous mapping at load, rather than resolving it at display time', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].maps.tracker = ['In Progress', 'Spec'];
    });
    expectRejectedNaming(result, 'states.1.maps.tracker.1');
  });

  it('names both states the value was claimed by', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].maps.tracker = ['In Progress', 'Spec'];
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.problems.map((problem) => problem.message).join(' ');
    expect(message).toContain('spec');
    expect(message).toContain('build');
  });

  it('allows the same raw value under two different providers, which are different vocabularies', () => {
    const result = readMutated((manifest) => {
      manifest.ownership.artifacts = 'repo';
      manifest.states[0].maps.repo = ['In Progress'];
      manifest.states[1].maps.repo = ['Spec'];
    });
    expect(result.ok).toBe(true);
  });
});

describe('rules 10 and 11 — transitions', () => {
  it('rejects a transition from an undeclared state', () => {
    const result = readMutated((manifest) => {
      manifest.transitions[0].from = 'nowhere';
    });
    expectRejectedNaming(result, 'transitions.0.from');
  });

  it('rejects a transition to an undeclared state', () => {
    const result = readMutated((manifest) => {
      manifest.transitions[0].to = 'nowhere';
    });
    expectRejectedNaming(result, 'transitions.0.to');
  });

  it('rejects a required gate that is not declared on the transition from state', () => {
    const result = readMutated((manifest) => {
      manifest.transitions[1].requires = ['spec-approved'];
    });
    expectRejectedNaming(result, 'transitions.1.requires.0');
  });

  it('allows a manifest with no transitions at all, meaning strictly linear', () => {
    const result = readMutated((manifest) => {
      delete manifest.transitions;
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.transitions).toEqual([]);
  });
});

describe('rule 12 — repo_config keys resolve, and target configurable gates', () => {
  it('rejects a key targeting an undeclared provider', () => {
    const result = readMutated((manifest) => {
      manifest.repo_config[0].key = 'providers.nowhere.project';
    });
    expectRejectedNaming(result, 'repo_config.0.key');
  });

  it('rejects a key targeting a gate that is not configurable', () => {
    const result = readMutated((manifest) => {
      manifest.repo_config[1].key = 'gates.review-approved.field';
    });
    expectRejectedNaming(result, 'repo_config.1.key');
  });

  it('rejects a key that resolves to nothing at all', () => {
    const result = readMutated((manifest) => {
      manifest.repo_config[0].key = 'something.else.entirely';
    });
    expectRejectedNaming(result, 'repo_config.0.key');
  });
});

describe('rule 13 — write-back needs somewhere to record', () => {
  it('rejects opting into transition write-back with no records target', () => {
    const result = readMutated((manifest) => {
      manifest.write_back.transitions = true;
    });
    expectRejectedNaming(result, 'write_back.records');
  });

  it('rejects opting into gate-result write-back with no records target', () => {
    const result = readMutated((manifest) => {
      manifest.write_back.gate_results = true;
    });
    expectRejectedNaming(result, 'write_back.records');
  });

  it('accepts write-back when a records target is declared', () => {
    const result = readMutated((manifest) => {
      manifest.write_back.transitions = true;
      manifest.write_back.records = { provider: 'tracker', as: 'comment' };
    });
    expect(result.ok).toBe(true);
  });
});

describe('rule 14 — locator templating references only declared identity fields', () => {
  it('rejects a template naming a field items.identity does not yield', () => {
    const result = readMutated((manifest) => {
      manifest.states[0].artifacts[0].path = 'docs/stories/{item.sprint}/spec.md';
    });
    expectRejectedNaming(result, 'states.0.artifacts.0.path');
  });

  it('accepts a template naming a field a pattern captures', () => {
    const result = readMutated((manifest) => {
      manifest.items.identity.patterns.repo = 'docs/(?<team>[a-z]+)/(?<key>[A-Z]+-[0-9]+)/story\\.md';
      manifest.states[0].artifacts[0].path = 'docs/{item.team}/{item.key}/spec.md';
    });
    expect(result.ok).toBe(true);
  });
});

describe('rule 15 — a manual gate must say where its decision is recorded', () => {
  it('rejects a manual gate with no evidence locator', () => {
    const result = readMutated((manifest) => {
      delete manifest.states[0].gates[0].evidence;
    });
    expectRejectedNaming(result, 'states.0.gates.0.evidence');
  });

  it('explains why, because a manual gate with nowhere to read from can never resolve', () => {
    const result = readMutated((manifest) => {
      delete manifest.states[0].gates[0].evidence;
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.message).join(' ')).toContain('evidence');
  });
});

describe('gate shape rules enforced by the schema', () => {
  it('rejects a check gate that names no check', () => {
    const result = readMutated((manifest) => {
      delete manifest.states[1].gates[0].check;
    });
    expectRejectedNaming(result, 'states.1.gates.0.check');
  });

  it('rejects a field gate with no passes_when', () => {
    const result = readMutated((manifest) => {
      delete manifest.states[1].gates[1].passes_when;
    });
    expectRejectedNaming(result, 'states.1.gates.1.passes_when');
  });

  it('rejects a check or field gate that names no provider', () => {
    const result = readMutated((manifest) => {
      delete manifest.states[1].gates[0].provider;
    });
    expectRejectedNaming(result, 'states.1.gates.0.provider');
  });

  it('rejects a condition carrying two operators, which would be ambiguous', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].gates[1].passes_when = { equals: 'approved', absent: true };
    });
    expectRejectedNaming(result, 'states.1.gates.1.passes_when');
  });

  it('rejects an unrecognised gate kind', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].gates[0].kind = 'vibes';
    });
    expectRejectedNaming(result, 'states.1.gates.0.kind');
  });

  it('rejects an unrecognised artifact kind', () => {
    const result = readMutated((manifest) => {
      manifest.states[0].artifacts[0].kind = 'spreadsheet';
    });
    expectRejectedNaming(result, 'states.0.artifacts.0.kind');
  });
});

describe('rejection reports a source line as well as a field (research.md §5)', () => {
  it('names the line of the offending field', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].gates[0].provider = 'nowhere';
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const problem = result.problems.find((candidate) => candidate.field === 'states.1.gates.0.provider');
    expect(problem?.line).toBeGreaterThan(0);
  });

  it('reports a YAML syntax error with its line, rather than throwing', () => {
    const result = readManifest('sdlc: 1\nid: broken\n  bad indentation: here\n');
    expect(result.ok).toBe(false);
  });
});

describe('a malformed manifest is never partially loaded (FR-044)', () => {
  it('returns no definition at all when any rule fails', () => {
    const result = readMutated((manifest) => {
      manifest.states[1].gates[0].provider = 'nowhere';
    });
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
  });

  it('reports every problem found at the failing stage, not only the first', () => {
    const result = readMutated((manifest) => {
      manifest.states[0].artifacts[0].provider = 'nowhere';
      manifest.items.discover[0].provider = 'elsewhere';
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a top-level document that is not a mapping', () => {
    expect(readManifest('- not\n- a\n- mapping\n').ok).toBe(false);
  });

  it('rejects an unrecognised top-level key rather than ignoring it', () => {
    const result = readMutated((manifest) => {
      manifest.stages = ['spec', 'build'];
    });
    expect(result.ok).toBe(false);
  });
});
