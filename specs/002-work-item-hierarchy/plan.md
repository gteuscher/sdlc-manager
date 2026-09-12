# Implementation Plan: Work Item Hierarchy

**Branch**: `002-work-item-hierarchy` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-work-item-hierarchy/spec.md`

## Summary

Work items form a tree when the lifecycle says they do. A parent renders as one row
that expands to reveal its children; a parent carries a marker when anything beneath
it needs the engineer, distinguishable from the parent needing them directly; and
items the engineer does not own appear as marked context rather than as their work.

The technical approach has one organising idea: **the tree is derived, never
stored.** The relationship is a field read from the system of record, and
everything the interface shows — grouping, roll-up, ordering, context marking — is a
pure function of the flat item list plus that field. Nothing new becomes
authoritative, which keeps Principle VI intact and means the cache-rebuild gate
covers this feature for free.

The second idea is that this is a **contract change before it is a code change**.
Contract v1 has no way to express a relationship, so the manifest contract gains an
optional `items.hierarchy` block and the reader learns to accept contract version 2
alongside 1. A v1 manifest keeps loading and rendering exactly as it does today,
which is what SC-005 demands.

## Technical Context

**Language/Version**: Unchanged — TypeScript 5.x `strict`, Node.js 22 LTS.

**Primary Dependencies**: **None added.** The tree is a disclosure pattern built
from the nested lists and buttons the renderer already uses; Radix ships no tree
primitive and one is not needed (research.md §3).

**Storage**: Unchanged. The relationship is read from the system of record through
the existing `Provider` interface; the derived tree is never written anywhere.

**Testing**: Unchanged — Vitest, React Testing Library, `vitest-axe`, Playwright.
The parity suite gains hierarchy cases so every fake exercises them.

**Target Platform**: Unchanged.

**Project Type**: Unchanged — extends `001-sdlc-work-item-dashboard`.

**Performance Goals**: Bundle budgets only. **The initial JS budget is the binding
constraint on this feature**: it stands at 136.83 KB of 150 KB, leaving ~13 KB. See
Constitution Check.

**Constraints**: Read-only; no new dependency; no change to how a lifecycle
declaring no hierarchy renders.

**Scale/Scope**: SC-006 and SC-007 — 200+ items with 50+ nested, and one parent with
200 children.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution v2.1.0.

| Principle | Status | How this design satisfies it |
|---|---|---|
| I. Local-First | PASS | No new service, no new credential. A hierarchical lifecycle backed by the filesystem works offline like any other. |
| II. Workflows Are Data | PASS | The relationship is declared in the manifest and named by the lifecycle. **No rule anywhere reads "if the provider is Jira"** — the framing note in spec.md records why the request was generalised. |
| III. Adapters | PASS | The parent reference is an ordinary field read through the existing `Provider` contract. No adapter learns what a hierarchy is. |
| IV. Fully Testable | PASS | Tree building, cycle detection, and roll-up are pure functions in `src/core/engine`, unit-testable with no DOM. The parity suite runs them against every fake. |
| V. Explicit State | PASS | The tree is derived from the system of record. A rolled-up marker is computed, never stored. |
| VI. Storage Follows the SDLC | PASS | Nothing new is authoritative. The cache gains no field that cannot be rebuilt. |
| VII. Optimize for Deletion | PASS | One new engine module and one new component. No generic tree abstraction, no render-prop tower. |
| VIII. Explicit Dependencies | PASS | The tree is passed as props; expansion is a URL-derived value, not context. |
| IX. Network Is the Boundary | PASS | The parent reference is untrusted producer output: validated at the boundary, and a self-referential or missing parent is data to be reported, not trusted. |
| X. Render What You Can Prove | PASS | A parent with no children renders as a plain row; a cycle renders a named report; a large group renders bounded. |
| XI. Accessibility | **PASS, with the most design risk here** | Radix has no tree primitive. The design uses the **disclosure pattern** — a nested list with `aria-expanded` buttons — rather than a full `role="tree"` widget, precisely because hand-rolling roving focus is the risk Principle XI's scope note warns against. See research.md §3. |
| XII. Dependency Weight Budget | **PASS, tightest gate** | ~13 KB of headroom remains. No dependency is added; the estimated cost is 2–4 KB. If it exceeds the budget, the response is to cut scope, not to raise the number. |
| XIII. State at the Edge | PASS | Expansion state is URL state (FR-009). Item data stays a query cache. No global store. |
| XIV. Discoverable Commands | PASS | No new command. `npm run verify` is unchanged. |

**Technology constraints**: TypeScript strict ✓ · React ✓ · headless primitives ✓ ·
no new runtime dependency ✓ · renderer hardening unchanged ✓.

**Result: PASS, no violations.** Complexity Tracking is therefore empty and removed.

### Two gates that deserve naming rather than a tick

**Principle XII is the one that could fail.** 136.83 KB of a 150 KB budget is
already spent, mostly by feature 001's own routes. This feature must fit in the
remainder. The design keeps the tree in the items route (already in the initial
chunk) and adds no dependency, but if `npm run size` fails, the correct responses
are to move the items route behind a lazy boundary or to cut FR-026's virtualisation
— **not** to amend the budget. Changing a budget number is a PATCH amendment and
would need its own justification.

**Principle XI is the one most likely to be done badly.** A tree is the classic
place where a `<div onClick>` with a rotating chevron passes visual review and is
unusable by keyboard. The disclosure pattern is chosen because it is correct by
construction: a real `<button aria-expanded aria-controls>` toggling a nested
`<ul>`, which needs no roving focus, no arrow-key handling, and no `tabindex`
management.

### Post-design re-check (after Phase 1)

Re-evaluated against the Phase 1 artifacts. Still PASS. The design strengthened two
principles from convention into structure:

- **Principle II** — the relationship field is named by the manifest, so the engine
  reads `items.hierarchy.parent.field` and never a field name of its own. A test
  asserts no hierarchy field name appears as a literal in `src/`.
- **Principle V** — `RolledUpAttention` is a distinct type from `AttentionSignal`,
  so FR-012's "visibly distinct" obligation is carried by the type system into every
  consumer rather than left to the component to remember.

One judgement recorded rather than hidden: **the contract version bump is a real
cost.** Adding an optional block would be a MINOR change, but `sdlc:` is an integer
with no minor channel, so an additive change is indistinguishable from a breaking
one. Bumping to 2 and supporting `[1, 2]` is the honest option; the alternative —
quietly adding an optional field to contract 1 — would make old readers reject new
manifests with no way to explain why. Recorded in research.md §1 as a gap in the
contract's versioning scheme, not papered over.

## Project Structure

### Documentation (this feature)

```text
specs/002-work-item-hierarchy/
├── spec.md
├── plan.md                       # This file
├── research.md                   # Phase 0 output
├── data-model.md                 # Phase 1 output
├── quickstart.md                 # Phase 1 output
├── contracts/
│   └── hierarchy.md              # The manifest contract amendment (v2)
├── checklists/
│   └── requirements.md
└── tasks.md                      # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

Additions to the existing tree. Nothing is restructured.

```text
src/
├── core/
│   ├── model/
│   │   └── declared.ts           # + HierarchyDecl on ItemDiscovery
│   │   └── observed.ts           # + ownership, parentKey, RolledUpAttention
│   ├── manifest/
│   │   ├── schema.ts             # + items.hierarchy, contract version 2
│   │   └── validate.ts           # + hierarchy validation rules
│   └── engine/
│       └── hierarchy.ts          # NEW — tree building, cycles, roll-up
├── main/
│   └── reconcile/
│       └── assemble.ts           # + read the declared parent field
└── renderer/
    ├── routes/Items.tsx          # + render the forest, expansion from the URL
    └── components/
        ├── ItemTree.tsx          # NEW — the disclosure group
        └── ItemRow.tsx           # + context marking, rolled-up marker

tests/
├── unit/hierarchy.*.test.ts      # tree building, cycles, roll-up, ownership
├── component/ItemTree.test.tsx   # expansion, keyboard, axe
└── parity/                       # hierarchy cases against every fake
```

**Structure Decision**: No new layer, no new package. The feature is one engine
module, one component, and additive fields on existing types. Principle VII's "a
component must be small enough that one engineer can delete and rewrite it in a
day" is the test this passes: deleting `hierarchy.ts` and `ItemTree.tsx` and
removing three fields returns the product to its current behaviour.
