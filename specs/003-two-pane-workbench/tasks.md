---

description: "Task list for Two-Pane Workbench implementation"
---

# Tasks: Two-Pane Workbench

**Input**: Design documents from `/specs/003-two-pane-workbench/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Test tasks ARE included. Constitution Principle IV ("Fully Testable") is
NON-NEGOTIABLE, and for this feature the tests are not merely required — they are
the *only* guard on FR-021. A re-shaping of this size loses behaviour by omission,
and a lost attention marker looks like a tidier interface rather than a
regression. Review will not catch that; the suites will.

Principle IV deliberately does **not** mandate test-first ordering, so no task
below requires a test to fail before implementation.

**Organization**: Grouped by user story so each can be implemented, tested, and
demonstrated independently.

**The measurement that matters**: 001's component suites — `ItemList`,
`StateTabs`, `GateList`, `ArtifactPanel`, `Markdown.safety`, `Console` — should
keep passing **without being edited**, with exactly one one-line exception (T003).
A suite that has to be adjusted to accommodate the layout means a pane learned it
was a pane, which plan.md §Structure Decision forbids. Watch for it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US3, mapping to spec.md user stories
- Exact file paths are given in every task

## Path Conventions

Single package, layered by process boundary per
[001's plan.md](../001-sdlc-work-item-dashboard/plan.md). This feature touches
`src/renderer/` and `tests/` only — **no task here changes `src/core`,
`src/providers`, `src/main`, or `src/preload`.** If one appears to need to,
something has gone wrong: this is a re-arrangement of the interface, and the data
beneath it is finished.

---

## Phase 1: Setup

**Purpose**: Establish the baseline this feature must not regress.

- [X] T001 Record the FR-021 baseline in `specs/003-two-pane-workbench/baseline.md`: run `npm run verify`, and write down the passing test count per suite, the initial-JS figure from `npm run size`, and the list of 001 component suites that must still pass unedited at the end
- [X] T002 [P] Confirm the markdown chunk boundary before touching anything: run `npm run build && npx size-limit` and record that `dist/renderer/assets/MarkdownArtifact*.js` is a separate chunk, so a later regression is attributable

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The parameter collision and the collapse preference, both of which
every user story depends on.

**⚠️ CRITICAL**: T003 must land before any pane work. It is a correctness fix, not
a tidy-up — without it the two panes silently rewrite each other's URL state.

- [X] T003 Rename the detail pane's tab parameter from `state` to `tab` in `src/renderer/routes/ItemDetail.tsx`: change `const PARAM_STATE = 'state'` to `const PARAM_TAB = 'tab'` and every read and write of it. `Items.tsx` keeps `?state=` for the list filter, unchanged (research.md §2)
- [X] T004 Update the tab-parameter assertion in `tests/component/StateTabs.test.tsx` to `?tab=`. **This change should be one line.** If it is larger, the test is coupled to something it should not be — report it rather than expanding the edit
- [X] T005 [P] Implement `src/renderer/query/usePaneState.ts`: reads and persists the list-collapsed preference at key `sdlc.workbench.listCollapsed` with values exactly `"true" | "false"`; **absent means expanded**; **an unreadable or throwing storage means expanded** — the state in which nothing is hidden (data-model.md §Persistence shape)
- [X] T006 [P] Test `usePaneState` in `tests/component/usePaneState.test.tsx`: absent key yields expanded, a storage accessor that throws yields expanded rather than propagating, a write is read back, and nothing outside the hook reads the key

**Checkpoint**: the collision is gone and the preference exists. Pane work can begin.

---

## Phase 3: User Story 1 — See what needs me and what I am working on, at once (Priority: P1) 🎯 MVP

**Goal**: The item list and the selected item's detail visible simultaneously as
two panes of one view, with selection changing only the detail.

**Independent Test**: Register a repository with several items including one
needing attention, select an item, and confirm the detail appears beside the list
rather than replacing it, with the list still showing every other item and its
markers.

### Tests for User Story 1

- [X] T007 [P] [US1] Test simultaneity in `tests/component/Workbench.test.tsx`: with an item selected, the list and the detail are both in the document, and every other item's attention marker is still present (FR-001, SC-001)
- [X] T008 [P] [US1] Test that selection does not disturb the list in `tests/component/Workbench.test.tsx`: selecting a second item changes the detail while the list keeps its scroll position and is not remounted (FR-004)
- [X] T009 [P] [US1] Test selection marking in `tests/component/Workbench.test.tsx`: the selected row carries `aria-current` and is distinguishable **without relying on colour** (FR-005)
- [X] T010 [P] [US1] Test the no-selection pane in `tests/component/Workbench.test.tsx`: with nothing selected the detail region contains deliberate copy, not an empty region and not a spinner (FR-006, Principle X)
- [X] T011 [P] [US1] Test landmarks and `vitest-axe` over the assembled view in `tests/component/Workbench.test.tsx`: exactly one `main` named "Item detail", one `complementary` named "Work items", and no violations (gate 6, contracts/workbench-layout.md §2)
- [X] T012 [P] [US1] Test independent failure in `tests/component/Workbench.test.tsx`: a detail pane that throws leaves the list rendered and selectable (FR-019)

### Implementation for User Story 1

- [X] T013 [US1] Create the shell in `src/renderer/routes/Workbench.tsx`: a two-column grid holding the list pane and `<Outlet />`, full viewport height. **Arrangement only** — no data fetching, no filter logic, no knowledge of either pane's internals (plan.md §Structure Decision)
- [X] T014 [P] [US1] Create `src/renderer/components/NoSelection.tsx`: the detail pane with nothing selected, carrying copy that says what selecting an item does (FR-006)
- [X] T015 [US1] Restructure the routes in `src/renderer/App.tsx`: `/` becomes a layout route rendering `Workbench`, with an index child rendering `NoSelection` and an `items/:key` child rendering the lazy `ItemDetail`. `/repositories` is untouched (FR-022). **Every existing URL must still resolve** (FR-007)
- [X] T016 [US1] Add the landmarks and accessible names in `src/renderer/routes/Workbench.tsx`: list pane `complementary` named "Work items", detail pane `main` named "Item detail". The list is **not** `navigation` — it is a list of work with status, and calling it navigation misdescribes it (contracts/workbench-layout.md §2)
- [X] T017 [US1] Give each pane its own error boundary in `src/renderer/routes/Workbench.tsx` using the existing `RouteErrorBoundary`, so a thrown render in one pane cannot blank the other (FR-019)
- [X] T018 [US1] Mark the selected item in `src/renderer/components/ItemRow.tsx`: `aria-current` plus a non-colour cue. Take selection as a prop — the row must not learn to read the route (Principle VIII)
- [X] T019 [US1] Add the two-column grid to `src/renderer/styles.css` under a clearly delimited section, using the full window height (FR-003)
- [X] T020 [US1] Confirm `ItemDetail` is still reached through `React.lazy` in `src/renderer/App.tsx`, so `react-markdown` stays out of the initial bundle — run `npm run build && npx size-limit` and compare against the T002 record (Principle XII)

**Checkpoint**: US1 is fully functional and independently demonstrable. This is the MVP, and it is the whole feature; everything after refines it.

---

## Phase 4: User Story 2 — Give the work room when I need it (Priority: P2)

**Goal**: A collapsible list pane that still reports attention while collapsed.

**Independent Test**: Collapse the pane, confirm the detail takes the width and the
attention state is still discoverable; expand and confirm scroll position and
selection are intact.

### Tests for User Story 2

- [X] T021 [P] [US2] Test collapse and expand in `tests/component/Workbench.test.tsx`: the control toggles the pane, and `aria-expanded` reflects the state (FR-008)
- [X] T022 [P] [US2] Test the collapsed rail still reports attention in `tests/component/Workbench.test.tsx`: with items needing attention, the count is present without expanding (FR-009) — a rail that hides the one signal the workbench exists to surface has defeated its own purpose
- [X] T023 [P] [US2] Test restoration in `tests/component/Workbench.test.tsx`: expanding restores the prior selection, and the collapse state survives a remount (FR-010, FR-011)
- [X] T024 [P] [US2] Test keyboard operation in `tests/component/Workbench.test.tsx`: the control is reachable and operable by keyboard in **both** states — a pane collapsed to nothing must not take its own expand control with it (FR-012)

### Implementation for User Story 2

- [X] T025 [US2] Create `src/renderer/components/PaneToggle.tsx`: a real `<button>` with `aria-expanded` and `aria-controls`, labelled "Hide the work item list" / "Show the work item list" (contracts/workbench-layout.md §2)
- [X] T026 [US2] Wire `usePaneState` into `src/renderer/routes/Workbench.tsx` so the collapse state persists across navigation and restarts (FR-011)
- [X] T027 [US2] Render the attention count in the collapsed rail in `src/renderer/routes/Workbench.tsx`, reusing `AttentionCount` rather than duplicating its logic (FR-009)
- [X] T028 [US2] Add the collapsed grid state to `src/renderer/styles.css`: the detail takes the freed width, and the toggle remains visible and focusable (FR-008, FR-012)
- [X] T029 [US2] Preserve list scroll position across collapse and expand in `src/renderer/routes/Workbench.tsx` — hide the pane rather than unmounting the list, so the browser keeps the position for us (FR-010)

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Filter and search without losing the workbench (Priority: P2)

**Goal**: Filtering and search narrow the list in place, leaving the detail alone.

**Independent Test**: With an item selected, apply a filter that excludes it, and
confirm the detail still shows that item while the list narrows.

### Tests for User Story 3

- [X] T030 [P] [US3] Test that narrowing leaves the detail alone in `tests/component/Workbench.test.tsx`: applying a filter changes the list and not the detail (FR-014)
- [X] T031 [P] [US3] Test the excluded selection in `tests/component/Workbench.test.tsx`: a filter that excludes the selected item leaves it rendered in the detail, and the list conveys that the selection is not currently listed (FR-015)
- [X] T032 [P] [US3] Test restoration in `tests/component/Workbench.test.tsx`: mounting at a URL carrying filter, search and selection restores all three (FR-016)

### Implementation for User Story 3

- [X] T033 [US3] Lay out the filters for the narrow pane in `src/renderer/components/ItemFilters.tsx` and `src/renderer/styles.css`: stacked rather than in a row, legible and usable at rail width (FR-013). **Behaviour is unchanged** — this is layout only
- [X] T034 [US3] Convey an out-of-filter selection in `src/renderer/routes/Workbench.tsx`: derive it at render time by testing the selected key against the filtered list, and say so in the list pane. **Do not persist "the selection was excluded"** — deriving it is what keeps it correct when the filter changes again (data-model.md §Derived, not stored)

**Checkpoint**: all three stories are independently functional.

---

## Phase 6: Degrading (Cross-Cutting)

**Purpose**: The behaviours FR-017 to FR-020 require, which belong to no single
story because they are about the view failing well.

- [X] T035 [P] Test narrow-window behaviour in `tests/component/Workbench.test.tsx`: below the threshold exactly one pane is present, with a control to reach the other, and neither is rendered unusably narrow (FR-017, SC-007)
- [X] T036 Implement single-pane mode in `src/renderer/styles.css` and `src/renderer/routes/Workbench.tsx`: below the width at which both panes are usable, show one at a time with an explicit control between them. The URL still decides which (research.md §4). **Squeezing both is not an acceptable degradation**
- [X] T037 [P] Test a vanished selection in `tests/component/Workbench.test.tsx`: an item that no longer exists produces a named message and a way back to the list, not a blank pane (FR-018)
- [X] T038 Implement the vanished-selection state in `src/renderer/routes/ItemDetail.tsx`, reusing the existing failure treatment rather than adding a new one (FR-018)
- [X] T039 [P] Test the deep-link pending state in `tests/component/Workbench.test.tsx`: arriving at `/items/:key` before the list has loaded shows a **bounded** pending state in the detail — bounded, because Principle X forbids a spinner without a timeout (FR-020)

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T040 **Prove FR-021.** Run `npx vitest run` and confirm `tests/component/{ItemList,StateTabs,GateList,ArtifactPanel,Markdown.safety,Console}.test.tsx` all pass, and that none was edited beyond T004's single line. Record the result in `specs/003-two-pane-workbench/baseline.md` against the T001 figures. **Any suite needing adjustment is a finding, not a chore** — report which, and why
- [X] T041 Run 001's quickstart scenarios V1–V5 against the workbench and record the results in `specs/003-two-pane-workbench/baseline.md` (SC-004). Attention-first ordering, the two visibly distinct markers, the attention count, unmapped raw values, provider disagreement, stale-with-retry, state tabs opening on the current state, the three gate statuses, artifact provenance, and the console must all still hold
- [X] T042 [P] Run quickstart.md scenarios W1–W12 and record the results in `specs/003-two-pane-workbench/baseline.md`, including SC-002's "one interaction to the next item" and SC-006's keyboard-only pass as observations
- [X] T043 [P] Extend `tests/smoke/scale.spec.ts` to select an item after the list renders, so SC-005 measures 200+ items **with both panes rendered** rather than the list alone (research.md §8)
- [X] T044 [P] Add `tests/smoke/workbench.spec.ts`: in the built application, both panes are present, selecting an item changes only the detail, and the collapse state survives a relaunch
- [X] T045 [P] Confirm `npm run size` passes and record the actual initial-JS figure against the ~141.2 KB projection in research.md §7. **If it fails, move `Items` behind a lazy boundary or trim the shell — do not raise the budget**
- [X] T046 [P] Update `README.md` if the two-pane arrangement changes what a first-time reader should expect to see
- [X] T047 Review `src/renderer` against the design-judgment principles VII, VIII, X and XIII, and append the result to `specs/001-sdlc-work-item-dashboard/design-review.md`. Specifically: did `Workbench.tsx` stay arrangement-only, or did it accumulate both panes' responsibilities?

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**. T003 in particular must land first
- **US1 (Phase 3)**: Depends on Foundational. This is the feature; US2 and US3 refine it
- **US2 (Phase 4)**: Depends on US1 — there is no pane to collapse until US1 exists
- **US3 (Phase 5)**: Depends on US1. Independent of US2
- **Degrading (Phase 6)**: Depends on US1
- **Polish (Phase 7)**: Depends on everything

### Within Each Story

Tests alongside implementation, in whichever order is fastest — Principle IV
requires the coverage, not the sequence.

### Parallel Opportunities

- Setup: T002 parallel with T001
- Foundational: T005 and T006 parallel with each other; both parallel with T003/T004
- US1: T007–T012 all parallel; T014 parallel with T013
- US2: T021–T024 all parallel
- US3: T030–T032 all parallel
- Degrading: T035, T037, T039 parallel
- Polish: T042–T046 parallel

**Note**: the US1 test tasks all touch `tests/component/Workbench.test.tsx`. They
are marked [P] because they are independent *assertions*, but if they are written
by separate hands they must be composed into one file rather than racing on it.

---

## Parallel Example: User Story 1 tests

```bash
Task: "Test simultaneity in tests/component/Workbench.test.tsx"
Task: "Test that selection does not disturb the list"
Task: "Test selection marking carries aria-current"
Task: "Test the no-selection pane has deliberate copy"
Task: "Test landmarks and vitest-axe over the assembled view"
Task: "Test independent failure leaves the list usable"
```

---

## Implementation Strategy

### MVP: Phases 1–3

Setup → Foundational → US1. That yields the two-pane workbench, which is the whole
of what was asked for. **Stop and validate** with quickstart W1, W2, W3 and W10
before continuing — W10 in particular, because it is the one that proves nothing
was lost in the move.

### Incremental Delivery

1. Phases 1–2 → the collision fixed, the preference in place
2. + US1 → **MVP**, validate with W1, W2, W3, W10
3. + US2 → collapsing, validate with W4
4. + US3 → filtering in the pane, validate with W5
5. + Degrading → validate with W8, W9
6. + Polish → W11, W12, and the FR-021 proof

### What to watch for

The failure mode for this feature is **quiet loss**, not visible breakage. A
dropped attention marker, a missing raw value on an unmapped item, a disagreement
that stopped being surfaced — each of those makes the interface look *cleaner*, and
none of them will announce itself. T040 and T041 exist for that reason and are not
optional polish.

The second thing to watch is the shell growing. `Workbench.tsx` should hold a grid,
a toggle, and an outlet. If it starts fetching, filtering, or knowing what a gate
is, the boundary has gone and Principle VII's test — delete the shell, restore two
routes, get today's product back — no longer holds.

---

## Notes

- `[P]` means a different file with no dependency on incomplete work
- Every task names its file path and, where a constraint is involved, quotes it
- No task in this feature touches `src/core`, `src/providers`, `src/main`, or
  `src/preload`. If one seems to need to, stop and say so
- Commit after each task or logical group; record any principle deviation in the
  commit message with the simpler alternative that was rejected
