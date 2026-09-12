# Implementation Plan: Two-Pane Workbench

**Branch**: `003-two-pane-workbench` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-two-pane-workbench/spec.md`

## Summary

The item list and the item detail become two panes of one view instead of two
pages. The list is persistent on the left, collapsible; the detail fills the rest;
both are visible at once.

The approach rests on one observation: **nothing needs to be rebuilt.** `Items`
and `ItemDetail` already render exactly what each pane must show, already read
their state from the URL, and already handle their own empty, pending and failure
states. What changes is where they are mounted — from two sibling routes to a
parent layout route with the detail as its child — and the shell that arranges
them.

That makes the risk profile unusual for a feature of this visible size: the
danger is not building the new thing, it is **losing something old while moving
it**. FR-021 names, item by item, every behaviour that must survive, and the plan
below is organised around proving that rather than around the layout itself.

## Technical Context

**Language/Version**: Unchanged — TypeScript 5.x `strict`, Node.js 22 LTS.

**Primary Dependencies**: **None added.** React Router already supports nested
routes with an outlet, which is the entire mechanism.

**Storage**: No change to any system of record or cache. One new browser-local
view preference (pane collapsed), discussed in research.md §3.

**Testing**: Unchanged stack. The component suites for `ItemList`, `StateTabs`,
`GateList`, `ArtifactPanel` and `Console` are the regression net for FR-021 and
must keep passing untouched wherever possible — a test that had to be rewritten
to accommodate the new layout is a signal worth examining, not a chore.

**Target Platform**: Unchanged.

**Project Type**: Unchanged — extends `001-sdlc-work-item-dashboard`.

**Performance Goals**: Bundle budgets only. Initial JS stands at **139.45 KB of
150 KB**; ~10.5 KB of headroom, and the markdown chunk must stay out of it.

**Constraints**: No behaviour withdrawn from 001. No new provider, manifest field,
or bridge method. No new dependency.

**Scale/Scope**: SC-005 — 200+ items rendered in the rail while a detail is open.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution v2.1.0.

| Principle | Status | How this design satisfies it |
|---|---|---|
| I. Local-First | PASS | No new service, credential, or network path. |
| II. Workflows Are Data | PASS | Layout knows nothing of any state, gate, or provider name (FR-023). The lint rule that forbids the vocabulary in `src/renderer` continues to apply and is the check. |
| III. Adapters | PASS | Untouched. |
| IV. Fully Testable | PASS | Components stay testable through rendered output. The panes are composed, not merged, so each keeps its own tests. |
| V. Explicit State | PASS | Item state still derives from the system of record. Layout state describes the furniture, never the work. |
| VI. Storage Follows the SDLC | PASS | Nothing new is authoritative. The one new persisted value is a view preference. |
| VII. Optimize for Deletion | **PASS, with a caveat** | The workbench shell is small. But `Items.tsx` (324 lines) becomes a pane rather than a page, and the temptation is to grow the shell into a god component. The plan keeps the shell to arrangement only — see Structure Decision. |
| VIII. Explicit Dependencies | PASS | The panes receive what they need as props and URL state; the shell adds no context. |
| IX. Network Is the Boundary | PASS | Untouched. |
| X. Render What You Can Prove | PASS | Each pane keeps its own empty, pending and failure states, and FR-019 requires that a failure in one never blanks the other — which the new `RouteErrorBoundary` already makes possible. The no-selection pane gets deliberate copy (FR-006). |
| XI. Accessibility | **PASS, the main design risk** | Two persistent panes need landmark roles, a sane keyboard path between them, and a collapse control that is operable and correctly labelled. See research.md §5. |
| XII. Dependency Weight Budget | **PASS, tightest gate** | ~10.5 KB of headroom. No dependency added; the shell is small. `ItemDetail` **must stay lazy** so the markdown chunk stays out of the initial bundle. |
| XIII. State at the Edge | **PASS, with one documented exception** | Selection, filters and the state tab stay URL state. Collapse becomes a browser-local preference, because FR-011 requires it to survive a restart and a URL cannot. Justified in research.md §3. |
| XIV. Discoverable Commands | PASS | No new command. |

**Technology constraints**: TypeScript strict ✓ · React ✓ · headless primitives ✓ ·
no new dependency ✓ · renderer hardening untouched ✓.

**Result: PASS, no violations.** Complexity Tracking is therefore empty and removed.

### Three things worth naming rather than ticking

**A URL parameter collision exists today and must be resolved first.** `Items.tsx`
reads `?state=` as the *list filter*; `ItemDetail.tsx` reads `?state=` as the
*selected tab*. They are separate routes, so the two never meet. Putting them in
one view makes them fight over one key: filtering the list would move the detail's
tab, and changing tab would filter the list. The detail's parameter is renamed to
`?tab=` (research.md §2). This is not a tidy-up — it is a correctness bug the
feature would otherwise introduce on its first day.

**Principle XIII gets an explicit exception, not a silent one.** Collapse state is
persisted browser-locally. The principle says global client state is a last resort
requiring written justification, and this is that justification: FR-011 asks for
persistence across restarts, which URL state cannot provide, and the value
describes the furniture rather than any work item. It is one boolean and it is
never read by anything but the shell.

**Principle XII could fail.** The budget is at 139.45 KB of 150. If the shell
pushes past it, the response is to move `Items` behind the same lazy boundary the
detail already uses, or to trim the shell — **not** to raise the number.

### Post-design re-check (after Phase 1)

Re-evaluated against the Phase 1 artifacts. Still PASS. The design improved two
things over the first sketch:

- **Principle VII** — the shell composes and does not merge. `Items` and
  `ItemDetail` keep their own files, their own tests, and their own state; the
  shell owns arrangement and nothing else. Deleting this feature means deleting one
  component and restoring two route entries.
- **FR-019** — a failure in one pane cannot blank the other, because each pane gets
  its own error boundary rather than sharing the route-level one. That is a
  structural guarantee, not a convention.

No entry is required in Complexity Tracking, which is for violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-two-pane-workbench/
├── spec.md
├── plan.md                       # This file
├── research.md                   # Phase 0 output
├── data-model.md                 # Phase 1 output
├── quickstart.md                 # Phase 1 output
├── contracts/
│   └── workbench-layout.md       # The UI contract: panes, landmarks, keyboard
├── checklists/
│   └── requirements.md
└── tasks.md                      # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

Additions and moves. Nothing is rewritten.

```text
src/renderer/
├── App.tsx                       # routes restructured: layout route + child
├── routes/
│   ├── Workbench.tsx             # NEW — the two-pane shell; arrangement only
│   ├── Items.tsx                 # unchanged behaviour; mounted as a pane
│   ├── ItemDetail.tsx            # `?state=` → `?tab=`; mounted as the outlet
│   └── Repositories.tsx          # untouched (FR-022)
├── components/
│   ├── PaneToggle.tsx            # NEW — collapse control
│   └── NoSelection.tsx           # NEW — the detail pane with nothing selected
├── query/
│   └── usePaneState.ts           # NEW — collapse preference, read and persisted
└── styles.css                    # the grid, and the narrow-window mode

tests/component/
├── Workbench.test.tsx            # NEW — simultaneity, selection, collapse, axe
└── (existing suites unchanged — they are the FR-021 regression net)

tests/smoke/
└── workbench.spec.ts             # NEW — both panes in the built app, at scale
```

**Structure Decision**: A shell that arranges, and two panes that do not know they
are panes. `Items` and `ItemDetail` keep their files and their tests; neither
learns about the other. The shell holds the grid, the collapse control, and the
outlet — nothing else.

This is Principle VII applied to a layout change, where the usual failure is a
shell that accumulates the responsibilities of both children until neither can be
tested alone. The test of the boundary: **deleting `Workbench.tsx` and restoring
two route entries returns the product to its current behaviour**, with no change to
either pane's source.
