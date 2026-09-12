/**
 * T018, T019, T020 — cross-field validation rules 1–15 of contracts/sdlc-manifest.md §5.
 *
 * Rules that can be expressed on a single field live in `schema.ts`. The ones here
 * need to see the whole manifest: uniqueness across states, provider references,
 * ownership, and mapping ambiguity.
 *
 * Every problem names the offending field path so that `parse.ts` can turn it into
 * a source line (FR-044). Validation is all-or-nothing — a manifest failing any
 * rule is never partially loaded.
 */

import type { ManifestProblem } from '../model/declared.js';
import type { RawManifest } from './schema.js';

/** `{item.<field>}` templating, per validation rule 14. */
const TEMPLATE_PATTERN = /\{item\.([A-Za-z0-9_]+)\}/g;
/** Named capture groups in an identity pattern, which are the fields it yields. */
const NAMED_GROUP_PATTERN = /\(\?<([A-Za-z][A-Za-z0-9_]*)>/g;

function problem(field: string, message: string): ManifestProblem {
  return { field, message };
}

/** Every identity field a locator template is allowed to reference (rule 14). */
export function declaredIdentityFields(raw: RawManifest): string[] {
  const fields = new Set<string>([raw.items.identity.correlate_on]);
  for (const pattern of Object.values(raw.items.identity.patterns ?? {})) {
    for (const match of pattern.matchAll(NAMED_GROUP_PATTERN)) {
      const name = match[1];
      if (name !== undefined) fields.add(name);
    }
  }
  return [...fields];
}

/** Rule 7 (T019). Every field in `ownership` names exactly one declared provider. */
function validateOwnership(raw: RawManifest, providerIds: Set<string>): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  for (const [field, value] of Object.entries(raw.ownership)) {
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      // Two owners is a validation error, never a runtime tie-break (FR-048).
      problems.push(
        problem(
          `ownership.${field}`,
          `ownership.${field} must name exactly one provider; ambiguous ownership is rejected at load rather than resolved at runtime`,
        ),
      );
      continue;
    }
    if (!providerIds.has(value)) {
      problems.push(
        problem(`ownership.${field}`, `ownership.${field} names provider "${value}", which is not declared in providers`),
      );
    }
  }
  return problems;
}

/** Rule 9 (T020). No raw value maps to more than one state, within one provider's vocabulary. */
function validateMappingAmbiguity(raw: RawManifest): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  /** provider id -> raw value -> the state that claimed it first */
  const claimed = new Map<string, Map<string, string>>();

  raw.states.forEach((state, stateIndex) => {
    for (const [providerId, values] of Object.entries(state.maps ?? {})) {
      let byValue = claimed.get(providerId);
      if (!byValue) {
        byValue = new Map<string, string>();
        claimed.set(providerId, byValue);
      }
      values.forEach((value, valueIndex) => {
        const existing = byValue.get(value);
        if (existing !== undefined) {
          problems.push(
            problem(
              `states.${stateIndex}.maps.${providerId}.${valueIndex}`,
              `provider "${providerId}" maps the raw value "${value}" to both state "${existing}" and state "${state.id}"; an ambiguous mapping is rejected at load, not resolved at display time`,
            ),
          );
          return;
        }
        byValue.set(value, state.id);
      });
    }
  });

  return problems;
}

/**
 * Runs rules 3–14. Rules 1, 2, and 15 are enforced earlier — 1 by the contract
 * version check in `parse.ts`, 2 and 15 by the schema.
 */
export function validateManifest(raw: RawManifest): ManifestProblem[] {
  const problems: ManifestProblem[] = [];

  // ── Rule 6 groundwork: the set of declared providers ──────────────────────
  const providerIds = new Set<string>();
  raw.providers.forEach((provider, index) => {
    if (providerIds.has(provider.id)) {
      problems.push(problem(`providers.${index}.id`, `duplicate provider id "${provider.id}"`));
    }
    providerIds.add(provider.id);
  });

  const requireProvider = (field: string, providerId: string, context: string): void => {
    if (!providerIds.has(providerId)) {
      problems.push(problem(field, `${context} names provider "${providerId}", which is not declared in providers`));
    }
  };

  // ── Rule 3: state ids unique ──────────────────────────────────────────────
  const stateIds = new Set<string>();
  raw.states.forEach((state, index) => {
    if (stateIds.has(state.id)) {
      problems.push(problem(`states.${index}.id`, `duplicate state id "${state.id}"; state ids must be unique`));
    }
    stateIds.add(state.id);
  });

  // ── Rules 4, 5, 6: gate and artifact ids, and every provider reference ────
  const gateIds = new Set<string>();
  /** state id -> the gate ids declared on it, for rule 11 */
  const gatesByState = new Map<string, Set<string>>();
  /** gate id -> whether it is configurable, for rule 12 */
  const gateConfigurable = new Map<string, boolean>();

  const identityFields = new Set(declaredIdentityFields(raw));
  const checkTemplate = (field: string, value: string | undefined): void => {
    if (value === undefined) return;
    for (const match of value.matchAll(TEMPLATE_PATTERN)) {
      const referenced = match[1];
      if (referenced !== undefined && !identityFields.has(referenced)) {
        // Rule 14.
        problems.push(
          problem(
            field,
            `locator references {item.${referenced}}, which is not declared in items.identity (declared: ${[...identityFields].join(', ')})`,
          ),
        );
      }
    }
  };

  raw.states.forEach((state, stateIndex) => {
    const artifactIds = new Set<string>();
    (state.artifacts ?? []).forEach((artifact, artifactIndex) => {
      const base = `states.${stateIndex}.artifacts.${artifactIndex}`;
      // Rule 5: artifact ids unique within their state.
      if (artifactIds.has(artifact.id)) {
        problems.push(
          problem(`${base}.id`, `duplicate artifact id "${artifact.id}" within state "${state.id}"; artifact ids must be unique within a state`),
        );
      }
      artifactIds.add(artifact.id);
      requireProvider(`${base}.provider`, artifact.provider, `artifact "${artifact.id}"`);
      checkTemplate(`${base}.path`, artifact.path);
      checkTemplate(`${base}.field`, artifact.field);
      checkTemplate(`${base}.run`, artifact.run);
    });

    const stateGates = new Set<string>();
    (state.gates ?? []).forEach((gate, gateIndex) => {
      const base = `states.${stateIndex}.gates.${gateIndex}`;
      // Rule 4: gate ids unique across the whole manifest, so transitions can reference them.
      if (gateIds.has(gate.id)) {
        problems.push(
          problem(`${base}.id`, `duplicate gate id "${gate.id}"; gate ids must be unique across the whole manifest so transitions can reference them`),
        );
      }
      gateIds.add(gate.id);
      stateGates.add(gate.id);
      gateConfigurable.set(gate.id, gate.configurable ?? false);

      if (gate.provider !== undefined) requireProvider(`${base}.provider`, gate.provider, `gate "${gate.id}"`);
      if (gate.evidence?.provider !== undefined) {
        requireProvider(`${base}.evidence.provider`, gate.evidence.provider, `gate "${gate.id}" evidence`);
      }
      checkTemplate(`${base}.path`, gate.path);
      checkTemplate(`${base}.field`, gate.field);
      checkTemplate(`${base}.check`, gate.check);
      checkTemplate(`${base}.evidence.path`, gate.evidence?.path);
      checkTemplate(`${base}.evidence.field`, gate.evidence?.field);
    });
    gatesByState.set(state.id, stateGates);

    for (const providerId of Object.keys(state.maps ?? {})) {
      requireProvider(`states.${stateIndex}.maps.${providerId}`, providerId, `state "${state.id}" maps`);
    }
  });

  // ── Rule 6 continued: items and write-back provider references ────────────
  raw.items.discover.forEach((rule, index) => {
    requireProvider(`items.discover.${index}.provider`, rule.provider, 'a discovery rule');
  });
  for (const providerId of Object.keys(raw.items.identity.patterns ?? {})) {
    requireProvider(`items.identity.patterns.${providerId}`, providerId, 'an identity pattern');
  }
  if (raw.write_back?.records !== undefined) {
    requireProvider('write_back.records.provider', raw.write_back.records.provider, 'write_back.records');
  }

  // ── Rule 7 (T019) ─────────────────────────────────────────────────────────
  problems.push(...validateOwnership(raw, providerIds));

  // ── Rule 8: a provider owning `state` maps every non-terminal state ───────
  const stateOwner = raw.ownership.state;
  if (providerIds.has(stateOwner)) {
    raw.states.forEach((state, index) => {
      if (state.terminal === true) return;
      const values = state.maps?.[stateOwner];
      if (values === undefined || values.length === 0) {
        problems.push(
          problem(
            `states.${index}.maps.${stateOwner}`,
            `state "${state.id}" declares no maps for "${stateOwner}", which owns state; every non-terminal state must be reachable from the owning provider's vocabulary`,
          ),
        );
      }
    });
  }

  // ── Rule 9 (T020) ─────────────────────────────────────────────────────────
  problems.push(...validateMappingAmbiguity(raw));

  // ── Rules 10 and 11: transitions ──────────────────────────────────────────
  (raw.transitions ?? []).forEach((transition, index) => {
    if (!stateIds.has(transition.from)) {
      problems.push(problem(`transitions.${index}.from`, `transition.from names state "${transition.from}", which is not declared`));
    }
    if (!stateIds.has(transition.to)) {
      problems.push(problem(`transitions.${index}.to`, `transition.to names state "${transition.to}", which is not declared`));
    }
    const declaredOnFrom = gatesByState.get(transition.from);
    (transition.requires ?? []).forEach((gateId, requireIndex) => {
      if (declaredOnFrom === undefined || !declaredOnFrom.has(gateId)) {
        problems.push(
          problem(
            `transitions.${index}.requires.${requireIndex}`,
            `transition requires gate "${gateId}", which is not declared on its from state "${transition.from}"`,
          ),
        );
      }
    });
  });

  // ── Rule 12: every repo_config key resolves, and targets a configurable gate ──
  (raw.repo_config ?? []).forEach((field, index) => {
    const segments = field.key.split('.');
    const [root, target] = segments;
    if (root === 'providers') {
      if (target === undefined || !providerIds.has(target)) {
        problems.push(
          problem(`repo_config.${index}.key`, `repo_config key "${field.key}" targets provider "${target ?? ''}", which is not declared`),
        );
      }
    } else if (root === 'gates') {
      if (target === undefined || !gateIds.has(target)) {
        problems.push(
          problem(`repo_config.${index}.key`, `repo_config key "${field.key}" targets gate "${target ?? ''}", which is not declared`),
        );
      } else if (gateConfigurable.get(target) !== true) {
        problems.push(
          problem(
            `repo_config.${index}.key`,
            `repo_config key "${field.key}" targets gate "${target}", which is not marked configurable: true`,
          ),
        );
      }
    } else {
      problems.push(
        problem(
          `repo_config.${index}.key`,
          `repo_config key "${field.key}" does not resolve; a key must begin with "providers." or "gates."`,
        ),
      );
    }
  });

  // ── Rule 13: write-back needs somewhere to record ─────────────────────────
  const writeBack = raw.write_back;
  if (writeBack !== undefined) {
    const writesAnything = writeBack.transitions === true || writeBack.gate_results === true;
    if (writesAnything && writeBack.records === undefined) {
      problems.push(
        problem('write_back.records', 'write_back.records is required when write_back.transitions or write_back.gate_results is true'),
      );
    }
  }

  return problems;
}
