# Implementation Plan: Bounding the Active List

**Branch**: `004-bound-active-list` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-bound-active-list/spec.md`

## Summary

Finished work becomes reachable, and a lifecycle that can never finish anything
becomes reportable.

The approach rests on one observation Phase 0 turned up: **this is a layering
defect, not a missing control.** The main process withholds terminal items before
the renderer sees them, and the renderer builds its filter options from what
arrived — so the escape hatch the main process documents ("naming that state
explicitly brings it back") can never be reached from the interface. Adding a
button on top of that arrangement would not have worked.

So the fix puts the question where it can be answered and the answer where it can
be used: the main process evaluates "is this item finished" once, per item, from
the repository's own definition, and says so on the wire. Three fields in three
existing shapes; no new channel, no new dependency, and nothing persisted.

## Technical Context

**Language/Version**: Unchanged — TypeScript 5.x `strict`, Node.js 22 LTS.

**Primary Dependencies**: **None added.**

**Storage**: **No change, and this is the feature's central claim.** Finishedness
is derived on every read from a definition already loaded. Nothing is written,
cached, or made authoritative — gate 4, the cache-rebuild test, is what proves it.

**Testing**: Unchanged stack. Unit coverage for the projection and the filter,
component coverage for the list, smoke coverage at scale.

**Target Platform**: Unchanged.

**Project Type**: Unchanged — extends `001-sdlc-work-item-dashboard` and the
workbench `003-two-pane-workbench` built.

**Performance Goals**: Bundle budgets. Initial JS stands at **141.06 KB of 150**;
**8.94 KB** of headroom, projected to ~8.2 KB after.

**Constraints**: No behaviour withdrawn from 001 or 003. No new provider, channel,
manifest field, or dependency. The application stays read-only. A lifecycle
condition is **reported, never enforced by refusing to track the work**.

**Scale/Scope**: SC-007 — 200+ items with finished work included.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution v2.1.0.

| Principle | Status | How this design satisfies it |
|---|---|---|
| I. Local-First | PASS | No new service, credential, or network path. |
| II. Workflows Are Data | **PASS, and the principle this feature is most about** | Finishedness is read from each repository's own manifest and never inferred from a state's name, ordinal, or position. The two reported conditions are arithmetic over the definition — `terminalStateCount === 0` and `=== stateCount` — and name no state, so the lint rule forbidding lifecycle vocabulary is unaffected. |
| III. Adapters | PASS | Untouched. No provider knows this feature exists. |
| IV. Fully Testable | PASS | The projection and the filter are plain functions over a loaded definition, unit-testable without a DOM. |
| V. Explicit State | PASS | Finishedness derives from the system of record via the definition, never from UI state. Nothing here changes what a gate result means. |
| VI. Storage Follows the SDLC | **PASS, checked by gate 4** | Nothing new is authoritative and nothing is stored. A rebuilt cache must reproduce identical finishedness, which is the sharpest available check that no one wrote it down. |
| VII. Optimize for Deletion | PASS | Three fields and one control. Removing the feature means deleting them; nothing is restructured to accommodate it. |
| VIII. Explicit Dependencies | PASS | The renderer is told which items are finished; it does not acquire a definition to work it out. |
| IX. Network Is the Boundary | PASS | All three new fields cross IPC and are validated by their existing zod schemas in both directions. |
| X. Render What You Can Prove | **PASS, with two deliberate refusals** | Unknowable finishedness resolves to "not finished" — the answer that hides nothing. And no count of hidden finished items is claimed, because the renderer cannot know one without fetching what it is avoiding (research.md §5). |
| XI. Accessibility | PASS | One new control and one new row marking. The marking must not rely on colour; the control is an ordinary form control, keyboard-operable by construction. |
| XII. Dependency Weight Budget | **PASS, tightest gate again** | 8.94 KB of headroom, ~0.7 KB projected spend. No dependency added. |
| XIII. State at the Edge | PASS | The inclusion flag is URL state, following the line 003 drew: the URL holds what another person or another session should be able to arrive at. |
| XIV. Discoverable Commands | PASS | No new command. One new fixture flag on an existing one. |

**Technology constraints**: TypeScript strict ✓ · React ✓ · headless primitives ✓ ·
no new dependency ✓ · renderer hardening untouched ✓ · validation at the boundary ✓.

**Result: PASS, no violations.** Complexity Tracking is therefore empty and removed.

### Four things worth naming rather than ticking

**Story 2 cannot be a validation rule, even though that is where it belongs.**
`validateManifest` returns `ManifestProblem[]`, its docblock states that validation
is all-or-nothing and a failing manifest is never partially loaded, and there is no
warning severity anywhere in the manifest pipeline. Reporting a lifecycle that
declares no terminal state as a *rule* would therefore reject it — contradicting
the spec's report-not-reject decision — and adding a warning channel would mean
changing the published manifest contract and migrating every consumer of
`ManifestProblem`, to carry a condition that is not an error. It becomes a derived
count on the package summary instead (research.md §4).

**This feature crosses layers, and 003's scope rule does not carry over.** 003
touched `src/renderer` only and made a point of it. This one necessarily touches
`src/core` (three schemas and a model type), `src/main` (two projections) and
`src/renderer` — the first feature since 001 to do so. It also **edits 001's
`ItemList` component fixtures**, which 003 deliberately did not: adding a required
field to `WorkItemSummary` means the three helpers that construct one gain a line
each. 003's "the suites must pass unedited" was a measurement device for a
re-arrangement, not a standing prohibition, and a feature that genuinely extends a
wire type is expected to touch the fixtures that build it. Recorded so the edit is
not later read as a regression.

**The fifth list-owned URL key is where 003's defect would come back.** 003 shipped
a bug in which the list rebuilt the whole query string on every filter write and
erased the detail pane's `?tab=`; the fix deletes and rewrites only the four keys
the list owns. `?finished=` is a fifth, and it must join that set. If it is added
to the control but not to the delete-and-rewrite set, it will appear to work —
surviving filter changes by accident — and break the first time that code is
reordered. Quickstart B7 exists for exactly this.

**Principle XII could fail.** 8.94 KB of headroom against ~0.7 KB of projected
spend is comfortable, but the response to a failure is to trim or to move `Items`
behind a lazy boundary — **not** to raise the number.

### Post-design re-check (after Phase 1)

Re-evaluated against the Phase 1 artifacts. Still PASS. The design improved two
things over the first sketch:

- **`terminalStateCount` became a number rather than a boolean.** One field now
  answers both conditions the spec requires — never releases work (`0`) and
  finishes work instantly (`=== stateCount`) — and keeps the *verdict* in the view
  rather than in the engine. A boolean would have needed a second field for the
  mirror case, and would have had the engine deciding what an engineer should be
  told.
- **The count of hidden finished items was dropped.** The first sketch had one.
  Phase 1 established that the renderer cannot know it without either fetching the
  items it is trying not to fetch or changing the list reply from an array to an
  object — a wide blast radius for a number that is only reassurance, and one that
  could be wrong. The visible control conveys the same thing and cannot be.

No entry is required in Complexity Tracking, which is for violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-bound-active-list/
├── spec.md
├── plan.md                       # This file
├── research.md                   # Phase 0 output
├── data-model.md                 # Phase 1 output
├── quickstart.md                 # Phase 1 output
├── contracts/
│   └── finished-work.md          # What finished means, and what says so
├── checklists/
│   └── requirements.md
└── tasks.md                      # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

Additions to existing files. Nothing is rewritten and no file is created in
`src/`.

```text
src/core/
├── ipc/schema.ts                 # +includeTerminal, +terminal, +terminalStateCount
└── model/observed.ts             # WorkItemSummary.terminal

src/main/ipc/
├── items.ts                      # matches() honours includeTerminal; toSummary derives terminal
└── repositories.ts               # toPackageSummary counts terminal states

src/renderer/
├── routes/Items.tsx              # the control, the fifth URL key, the new empty state
├── routes/Repositories.tsx       # reports a lifecycle that never releases work
├── components/ItemFilters.tsx    # the control
├── components/ItemRow.tsx        # marks a finished row
└── styles.css

scripts/fixture.ts                # a lifecycle declaring no terminal state

tests/
├── unit/items.aggregate.test.ts  # the filter branch and the derivation
├── unit/cache.rebuild.test.ts    # derived, not stored (gate 4)
├── component/ItemList.test.tsx   # +1 fixture line, and the control's behaviour
├── component/Workbench.test.tsx  # +1 fixture line
├── component/Repositories.test.tsx # the package condition report
└── smoke/scale.spec.ts           # SC-007, with finished work included
```

**Structure Decision**: **the question is answered once, in the projection, and
everything downstream consumes the answer.**

`toSummary` is the only place that asks a definition whether a state is terminal;
`toPackageSummary` is the only place that counts them. No component, and nothing
in `src/renderer`, ever evaluates finishedness — the renderer reads a boolean it
was handed. That is what keeps Principle II intact through a feature whose whole
subject is a lifecycle property, and it is why `terminal` is required rather than
optional on the summary: an optional field would push the "unknown means not
finished" decision out to every consumer.

The test of the boundary: **grep `src/renderer` for `terminal` and the only hits
should be reading the field, never deciding it.** If the renderer ever needs a
definition to know what to show, the boundary has gone.
