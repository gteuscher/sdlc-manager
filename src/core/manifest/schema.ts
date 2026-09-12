/**
 * T016 — the executable form of contracts/sdlc-manifest.md §4.
 *
 * This schema is the single implementation of the contract's field rules; the
 * contract document is the normative prose describing it (research.md §16 Q3).
 * Two hand-maintained copies would drift, so there is only one, and it is the one
 * that produces FR-044's field-level errors.
 *
 * The schema covers *shape*. Cross-field rules 1–15 live in `validate.ts`, because
 * several of them need to see the whole manifest at once.
 */

import { z } from 'zod';

/**
 * A state id must start alphanumeric. This is what keeps the `UNMAPPED` sentinel
 * (a leading NUL) unrepresentable as a state id, so an unresolvable state can
 * never collide with a declared one.
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const idField = (what: string) =>
  z
    .string()
    .min(1, `${what} must be present and non-empty`)
    .regex(ID_PATTERN, `${what} must start with a letter or digit and contain only letters, digits, dot, underscore, or hyphen`);

const nonEmpty = (what: string) => z.string().min(1, `${what} must be present and non-empty`);

/** The keys a `passes_when` condition may carry. Exactly one is required. */
export const CONDITION_KEYS = ['equals', 'not_equals', 'one_of', 'matches', 'present', 'absent'] as const;

export const conditionSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    const keys = Object.keys(value);
    const recognised = keys.filter((key) => (CONDITION_KEYS as readonly string[]).includes(key));
    if (recognised.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a condition must use one of: ${CONDITION_KEYS.join(', ')}`,
      });
      return;
    }
    if (recognised.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a condition must use exactly one of: ${CONDITION_KEYS.join(', ')}; found ${recognised.join(', ')}`,
      });
    }
    const unknownKeys = keys.filter((key) => !(CONDITION_KEYS as readonly string[]).includes(key));
    if (unknownKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unrecognised condition key(s): ${unknownKeys.join(', ')}`,
      });
    }
  });

export const providerDeclSchema = z
  .object({
    id: idField('provider.id'),
    kind: nonEmpty('provider.kind'),
  })
  // Provider-specific settings are validated by the adapter, not here
  // (sdlc-manifest.md §3). Core must not know what a tracker needs.
  .passthrough();

export const locatorSchema = z
  .object({
    provider: idField('locator.provider').optional(),
    path: z.string().min(1).optional(),
    field: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
    check: z.string().min(1).optional(),
  })
  .strict();

export const ARTIFACT_KINDS = ['markdown', 'tracker', 'test-results'] as const;

export const artifactDeclSchema = z
  .object({
    id: idField('artifact.id'),
    name: z.string().min(1).optional(),
    kind: z.enum(ARTIFACT_KINDS, {
      errorMap: () => ({ message: `artifact.kind must be one of: ${ARTIFACT_KINDS.join(', ')}` }),
    }),
    provider: idField('artifact.provider'),
    path: z.string().min(1).optional(),
    field: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
    required: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.path === undefined && value.field === undefined && value.run === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an artifact must declare a locator: one of path, field, or run',
      });
    }
  });

export const GATE_KINDS = ['manual', 'artifact', 'check', 'field'] as const;

export const gateDeclSchema = z
  .object({
    id: idField('gate.id'),
    name: nonEmpty('gate.name'),
    kind: z.enum(GATE_KINDS, {
      errorMap: () => ({ message: `gate.kind must be one of: ${GATE_KINDS.join(', ')}` }),
    }),
    blocking: z.boolean().optional(),
    awaits_human: z.boolean().optional(),
    configurable: z.boolean().optional(),
    provider: idField('gate.provider').optional(),
    evidence: locatorSchema.optional(),
    passes_when: conditionSchema.optional(),
    path: z.string().min(1).optional(),
    field: z.string().min(1).optional(),
    check: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Rule 15. A manual gate with nowhere to read its decision from could only
    // ever be not_evaluated, so the manifest is rejected rather than silently
    // producing a gate that never resolves (research.md §16 Q1).
    if (value.kind === 'manual' && value.evidence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence'],
        message:
          'a gate with kind: manual must declare an evidence locator naming where its decision is recorded (validation rule 15)',
      });
    }
    if ((value.kind === 'check' || value.kind === 'field') && value.provider === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['provider'],
        message: `a gate with kind: ${value.kind} must name the provider supplying its result`,
      });
    }
    if (value.kind === 'field' && value.passes_when === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passes_when'],
        message: 'a gate with kind: field must declare passes_when',
      });
    }
    if (value.kind === 'field' && value.field === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['field'],
        message: 'a gate with kind: field must name the field it reads',
      });
    }
    if (value.kind === 'artifact' && value.passes_when === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passes_when'],
        message: 'a gate with kind: artifact must declare passes_when',
      });
    }
    if (value.kind === 'check' && value.check === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['check'],
        message: 'a gate with kind: check must name the check whose result it reads',
      });
    }
  });

export const stateSchema = z
  .object({
    id: idField('state.id'),
    name: nonEmpty('state.name'),
    description: z.string().optional(),
    awaits_human: z.boolean().optional(),
    terminal: z.boolean().optional(),
    maps: z.record(z.string(), z.array(z.string().min(1))).optional(),
    artifacts: z.array(artifactDeclSchema).optional(),
    gates: z.array(gateDeclSchema).optional(),
  })
  .strict();

export const transitionSchema = z
  .object({
    from: nonEmpty('transition.from'),
    to: nonEmpty('transition.to'),
    name: z.string().min(1).optional(),
    requires: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const ownershipSchema = z
  .object({
    state: idField('ownership.state'),
    title: idField('ownership.title'),
    assignee: idField('ownership.assignee').optional(),
    artifacts: idField('ownership.artifacts'),
  })
  .strict();

export const itemsSchema = z
  .object({
    unit: z.string().min(1).optional(),
    discover: z
      .array(
        z
          .object({
            provider: idField('items.discover.provider'),
            query: z.string().min(1).optional(),
            glob: z.string().min(1).optional(),
          })
          .strict()
          .superRefine((value, ctx) => {
            if (value.query === undefined && value.glob === undefined) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'a discovery rule must declare either a query or a glob',
              });
            }
          }),
      )
      .min(1, 'items.discover must declare at least one rule'),
    identity: z
      .object({
        correlate_on: nonEmpty('items.identity.correlate_on'),
        patterns: z.record(z.string(), z.string().min(1)).optional(),
      })
      .strict(),
  })
  .strict();

export const writeBackSchema = z
  .object({
    transitions: z.boolean().optional(),
    gate_results: z.boolean().optional(),
    records: z
      .object({
        provider: idField('write_back.records.provider'),
        as: z.enum(['comment', 'field', 'file']),
      })
      .strict()
      .optional(),
  })
  .strict();

export const repoConfigFieldSchema = z
  .object({
    key: nonEmpty('repo_config.key'),
    title: nonEmpty('repo_config.title'),
    type: z.enum(['string', 'number', 'boolean'], {
      errorMap: () => ({ message: 'repo_config.type must be one of: string, number, boolean' }),
    }),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    description: z.string().optional(),
  })
  .strict();

export const manifestSchema = z
  .object({
    sdlc: z.number().int('sdlc must be an integer contract version'),
    id: idField('id'),
    name: nonEmpty('name'),
    version: nonEmpty('version'),
    description: z.string().optional(),
    providers: z.array(providerDeclSchema).min(1, 'providers must declare at least one provider'),
    ownership: ownershipSchema,
    items: itemsSchema,
    states: z.array(stateSchema).min(1, 'states must declare at least one state'),
    transitions: z.array(transitionSchema).optional(),
    write_back: writeBackSchema.optional(),
    repo_config: z.array(repoConfigFieldSchema).optional(),
  })
  .strict();

export type RawManifest = z.infer<typeof manifestSchema>;
export type RawState = z.infer<typeof stateSchema>;
export type RawGate = z.infer<typeof gateDeclSchema>;
export type RawArtifact = z.infer<typeof artifactDeclSchema>;
