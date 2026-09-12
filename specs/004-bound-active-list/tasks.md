---

description: "Task list for Bounding the Active List implementation"
---

# Tasks: Bounding the Active List

**Input**: Design documents from `/specs/004-bound-active-list/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Test tasks ARE included. Constitution Principle IV ("Fully Testable") is
NON-NEGOTIABLE, and this feature has a second reason: it changes **which items are
listed**, which is the change most able to drop an ordering rule or a marker while
looking tidier for it. SC-006 requires every 001 and 003 acceptance scenario to
still pass, and only the suites can show that.

Principle IV deliberately does **not** mandate test-first ordering, so no task
below requires a test to fail before implementation.

**Organization**: Grouped by user story so each can be implemented, tested, and
demonstrated independently.

**The gate that matters most here is gate 4.** This feature's central claim is that
finishedness is *derived, never stored*. The cache-rebuild test is the one check
that would notice if a `terminal` value were ever written down — a rebuilt cache
disagreeing with the definition is precisely the failure the claim prevents. T008
is not routine coverage.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US3, mapping to spec.md user stories
- Exact file paths are given in every task

## Path Conventions

Single package, layered by process boundary per
[001's plan.md](../001-sdlc-work-item-dashboard/plan.md).

**Unlike 003, this feature crosses layers** — `src/core`, `src/main` and
`src/renderer` — and **it edits 001's `ItemList` fixtures**, which 003 made a point
of not doing. Adding a required field to a wire type obliges the fixtures that
construct one to supply it. That is expected here and is not a regression; plan.md
§"Four things worth naming" records why.

No task in this feature touches `src/providers` or `src/preload`. If one seems to,
stop: every provider already reports the state an item rests in, and what that
state *means* is the manifest's business.

---

## Phase 1: Setup

**Purpose**: Establish the baseline this feature must not regress.

- [ ] T001 Record the baseline in `specs/004-bound-active-list/baseline.md`: run `npm run verify`, and write down the passing test count per suite, the initial-JS figure from `npm run size` (**141.06 KB of 150** at 003's close), and the 001/003 suites that SC-006 requires to still pass
- [ ] T002 [P] Record the Principle II boundary baseline in the same file: `grep -rn "terminal" src/renderer` before anything changes, so plan.md's boundary test — *the renderer reads the field, never decides it* — has a before and an after to compare

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared wire type. Adding a **required** field to `WorkItemSummary`
breaks the typecheck everywhere one is constructed, so this lands whole or not at
all.

**⚠️ CRITICAL**: T003–T006 are one change spread over four files. Between T003 and
T006 the build is red; do not stop in the middle.

- [ ] T003 Add `readonly terminal: boolean` to `WorkItemSummary` in `src/core/model/observed.ts`, documented as "the state this item rests in is declared terminal by this repository's definition". **Required, not optional** — an optional field pushes the "unknown means not finished" decision out to every consumer, and contracts/finished-work.md §1 places that decision in one process on purpose
- [ ] T004 Add `terminal: z.boolean()` to the work item summary schema in `src/core/ipc/schema.ts`, so it is validated leaving the main process and arriving in the renderer (Principle IX)
- [ ] T005 Derive it in `toSummary` in `src/main/ipc/items.ts`, reusing the existing `isTerminal` helper rather than a second implementation. Three rules from data-model.md, each a failure mode the spec names: **an unmapped item is never terminal** (FR-015); **a repository whose definition failed to load is never terminal** (FR-016); **it is recomputed on every projection and cached nowhere** (FR-017)
- [ ] T006 Add the field to the three fixture helpers that construct a `WorkItemSummary`: `tests/component/ItemList.test.tsx`, `tests/component/Workbench.test.tsx`, `tests/unit/cache.rebuild.test.ts`. **One line each.** If any needs more, the fixture has grown a second purpose — report it rather than expanding the edit
- [ ] T007 [P] Test the derivation in `tests/unit/items.aggregate.test.ts`: an item resting in a declared-terminal state reports `true`; an item in a non-terminal state reports `false`; an **unmapped** item reports `false`; an item whose repository has no loaded definition reports `false`
- [ ] T008 Test that it is **derived, not stored**, in `tests/unit/cache.rebuild.test.ts`: deleting the cache and rebuilding from the provider fakes reproduces identical `terminal` values (gate 4, Principle VI). This is the task that would catch someone persisting it

**Checkpoint**: every item now says whether it is finished, and nothing recorded it.

---

## Phase 3: User Story 1 — See what finished, and confirm it finished where I expected (Priority: P1) 🎯 MVP

**Goal**: Finished work is reachable from the list pane, marked, and openable —
excluded by default.

**Independent Test**: Register a repository whose lifecycle declares a terminal
state with at least one item resting in it. Confirm the item is absent by default,
that one deliberate action brings it into view marked as finished and naming the
state it finished in, and that opening it shows everything an active item shows.

### Tests for User Story 1

- [ ] T009 [P] [US1] Test the filter branch in `tests/unit/items.aggregate.test.ts`: absent and `false` exclude terminal items; `true` includes them; and **naming a `stateId` still returns terminal items in that state**, since that rule is retained rather than replaced (data-model.md)
- [ ] T010 [P] [US1] Test the default and the control in `tests/component/ItemList.test.tsx`: finished work is absent on first render (FR-001), a persistently visible control includes it (FR-002), and excluding returns the list to exactly what it was
- [ ] T011 [P] [US1] Test the marking in `tests/component/ItemList.test.tsx`: a finished row is distinguishable **without relying on colour** and names the state it finished in as that lifecycle names it (FR-003)
- [ ] T012 [P] [US1] Test that filters narrow finished work in `tests/component/ItemList.test.tsx`: repository, SDLC, state and search narrow finished items exactly as they narrow active ones (FR-006) — finished work is more of the same list, not a second list
- [ ] T013 [P] [US1] Test that the detail is undisturbed in `tests/component/Workbench.test.tsx`: with an item open, including and then excluding finished work leaves the detail pane showing the same item (FR-005, SC-008). This is 003's FR-014 rule applied to a new control, and a well-meaning refetch is what would break it
- [ ] T014 [P] [US1] Test the all-finished empty state in `tests/component/ItemList.test.tsx`: with every item finished, the list distinguishes "nothing is in flight" from "nothing is here" and points at the finished work (spec §Edge Cases). An engineer must not be able to conclude their repository is broken
- [ ] T015 [P] [US1] Test `vitest-axe` over the list with finished work included and the control in both states, in `tests/component/ItemList.test.tsx` (gate 6, Principle XI)

### Implementation for User Story 1

- [ ] T016 [US1] Add `includeTerminal: z.boolean().optional()` to `itemFilterSchema` in `src/core/ipc/schema.ts`. Absent means `false`, so every existing caller is unchanged (contracts/finished-work.md §2)
- [ ] T017 [US1] Honour it in `matches()` in `src/main/ipc/items.ts`: exclude a terminal item unless `includeTerminal === true` **or** a `stateId` is named. Keep the existing `stateId` rule — it costs nothing and removing it is a behaviour change this feature has no reason to make
- [ ] T018 [US1] Add the finished control to `src/renderer/components/ItemFilters.tsx`, following the component's existing shape: it holds no state, `value` comes in and `onChange` goes out. A native control, keyboard-operable by construction (Principle XI, XII)
- [ ] T019 [US1] Wire `?finished=1` in `src/renderer/routes/Items.tsx`: read it, pass `includeTerminal` to `useItems`, **and add the new key to the set `writeFilterKeys` deletes and rewrites**. ⚠️ This is where 003's W6 defect would return — the list rebuilding the query string and erasing the detail's `?tab=`. A fifth list-owned key that is added to the control but not to that set will appear to work, surviving filter changes by accident, and break the first time the code is reordered
- [ ] T020 [US1] Mark a finished row in `src/renderer/components/ItemRow.tsx`: a non-colour cue plus the state it finished in. Take it from the `terminal` prop on the summary — the row must not decide finishedness, only render it (plan.md §Structure Decision)
- [ ] T021 [US1] Add the all-finished empty-state branch in `src/renderer/routes/Items.tsx`, beside the existing empty states, with copy that names what is being offered (FR-002, Principle X)
- [ ] T022 [P] [US1] Style the control, the finished row and the empty state in `src/renderer/styles.css`, under the delimited workbench section 003 created
- [ ] T023 [US1] Confirm `src/renderer/components/CollapsedRail.tsx` still calls `useItems()` **with no filter**, so the collapsed rail stays on the bounded query. Attention is never raised on a terminal state, so its count is identical either way and it must not pull the larger list (research.md §2)

**Checkpoint**: US1 is fully functional and independently demonstrable. This is the MVP.

---

## Phase 4: User Story 2 — Be told when a lifecycle can never let work go (Priority: P2)

**Goal**: A lifecycle declaring no terminal state — or declaring every state
terminal — is reported against its package, and still tracked.

**Independent Test**: Install a lifecycle package declaring no terminal state and
register it. Confirm the repositories view reports it by name with the consequence,
and that the repository still registers and its items still appear and open.

**Independent of US1.** It touches a different view and a different projection.

### Tests for User Story 2

- [ ] T024 [P] [US2] Test the count in `tests/unit/boot.zero-config.test.ts`, beside the existing `stateCount` assertion: a lifecycle with one terminal state reports `1`, one with none reports `0`, one where every state is terminal reports `stateCount`
- [ ] T025 [P] [US2] Test the report in `tests/component/Repositories.test.tsx`: `terminalStateCount === 0` renders a message **naming the package** and stating the consequence — items following it never leave the active list (FR-010, FR-011) — and saying the correction belongs in the package
- [ ] T026 [P] [US2] Test the mirror case in `tests/component/Repositories.test.tsx`: `terminalStateCount === stateCount` is reported on the same terms (FR-014)
- [ ] T027 [P] [US2] Test that it is a report and not a refusal in `tests/component/Repositories.test.tsx`: such a package is still listed, still selectable for registration, and carries no `problem` and no unsupported marking (FR-012). **A refusal here is a failure, not a stricter reading**
- [ ] T028 [P] [US2] Test the quiet case in `tests/component/Repositories.test.tsx`: a healthy lifecycle reports nothing at all

### Implementation for User Story 2

- [ ] T029 [US2] Add `terminalStateCount: z.number()` to `sdlcPackageSummarySchema` in `src/core/ipc/schema.ts`, beside the `stateCount` it already carries
- [ ] T030 [US2] Count it in `toPackageSummary` in `src/main/ipc/repositories.ts` from the loaded definition. **A count, not a verdict** — one field answers both conditions, and the engine does not decide what an engineer should be told (research.md §4)
- [ ] T031 [US2] Add the field to the `SdlcPackageSummary` fixtures in `tests/component/Repositories.test.tsx` (three of them) and anywhere else one is constructed, including `tests/support/bridge.ts` if it builds one. One line each
- [ ] T032 [US2] Report both conditions in `src/renderer/routes/Repositories.tsx`, beside where `stateCount` is already rendered. Neither test names a state, so the lint rule forbidding lifecycle vocabulary must still pass unchanged (FR-020, Principle II)
- [ ] T033 [US2] Add a lifecycle declaring no terminal state to `scripts/fixture.ts` — the default lifecycle with `terminal: true` removed from its final state and **nothing else changed**, so the only variable is the one under test. Follow the existing flag vocabulary (`fixture package --omit-manifest` is the precedent). Without this, User Story 2 cannot be walked at all

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Return to, and share, a view that includes finished work (Priority: P3)

**Goal**: The inclusion travels in the address, like every other filter.

**Independent Test**: Include finished work, apply a filter and a search, open an
item, copy the address, and open it fresh. All four come back.

**Depends on US1**, which creates the key. This phase proves it behaves.

### Tests for User Story 3

- [ ] T034 [P] [US3] Test restoration in `tests/component/Workbench.test.tsx`: mounting at an address carrying the finished flag, a filter, a search and a selection restores all four together (FR-007)
- [ ] T035 [P] [US3] Test the default in `tests/component/Workbench.test.tsx`: an address that does not mention finished work excludes it — the quieter default, and the one that keeps the list bounded for someone who has never heard of this feature
- [ ] T036 [P] [US3] Test the collision, both directions, in `tests/component/Workbench.test.tsx`: with finished work included and a detail tab open, changing a filter leaves `?tab=` untouched and leaves the finished flag set; "Clear filters" clears the finished flag **along with the other filters** and still leaves `?tab=` alone (quickstart B7)

### Implementation for User Story 3

- [ ] T037 [US3] Complete whatever T019 did not: confirm the flag is read from the address rather than remembered anywhere, that it is written with `replace` like the other filters, and that it is absent from the address when off rather than written as a falsy value

**Checkpoint**: all three stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T038 **Prove SC-006.** Run `npx vitest run` and confirm every 001 and 003 suite passes, and record which files were edited and why against the T001 baseline. The expected edits are the fixture lines from T006 and T031 — **any suite needing a change beyond supplying a new field is a finding, not a chore**
- [ ] T039 Run quickstart scenarios **B1–B15** against a built application and record the results in `specs/004-bound-active-list/baseline.md`, including B14's re-run of 001's V1–V5 and 003's W1–W12 (SC-006) as the load-bearing one
- [ ] T040 [P] Extend `tests/smoke/scale.spec.ts` to include finished work in the 220-item measurement, so SC-007 covers the longer list rather than the active one alone
- [ ] T041 [P] Confirm `npm run size` passes and record the actual initial-JS figure against the ~141.8 KB projection in research.md §7. **If it fails, trim or move `Items` behind a lazy boundary — do not raise the budget**
- [ ] T042 [P] Run the Principle II boundary test from plan.md: `grep -rn "terminal" src/renderer` and confirm every hit **reads** the field and none **decides** it. Compare against the T002 baseline
- [ ] T043 [P] Update `README.md` if finished work changes what a first-time reader should expect the list to contain
- [ ] T044 Append this feature's result to `specs/001-sdlc-work-item-dashboard/design-review.md`, reviewing principles VI, VII, VIII, X and XIII over the changed code. Specifically: did anything end up storing finishedness, and did the renderer stay a consumer of the answer rather than a second judge of it?

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS US1 and US3**. T003–T006 are one change and the build is red between them
- **US1 (Phase 3)**: Depends on Foundational. This is the MVP
- **US2 (Phase 4)**: Depends on Setup only — **independent of Foundational and of US1**. It touches a different projection and a different view, and could be built first
- **US3 (Phase 5)**: Depends on US1, which creates the key
- **Polish (Phase 6)**: Depends on everything

### Within Each Story

Tests alongside implementation, in whichever order is fastest — Principle IV
requires the coverage, not the sequence.

### Parallel Opportunities

- Setup: T002 parallel with T001
- Foundational: T007 parallel with T008; both after T005
- US1: T009–T015 all parallel; T022 parallel with the rest
- US2: T024–T028 all parallel; T033 parallel with everything in the phase
- US3: T034–T036 all parallel
- Polish: T040–T043 parallel
- **US2 is parallel with the whole of US1 and US3** — different files throughout

**Note**: T010–T012, T014 and T015 all touch `tests/component/ItemList.test.tsx`,
and T025–T028 all touch `tests/component/Repositories.test.tsx`. They are marked
[P] because they are independent *assertions*, but if written by separate hands
they must be composed into one file rather than racing on it.

---

## Parallel Example: User Story 1 tests

```bash
Task: "Test the filter branch in tests/unit/items.aggregate.test.ts"
Task: "Test the default and the control in tests/component/ItemList.test.tsx"
Task: "Test the marking survives greyscale"
Task: "Test filters narrow finished work too"
Task: "Test the detail is undisturbed in tests/component/Workbench.test.tsx"
Task: "Test the all-finished empty state"
Task: "Test vitest-axe over the list with finished work shown"
```

---

## Implementation Strategy

### MVP: Phases 1–3

Setup → Foundational → US1. That delivers reachable finished work, which is the
half an engineer meets daily. **Stop and validate** with quickstart B1, B2, B3, B4
and B7 before continuing — B7 in particular, because it is the one that proves
003's URL defect has not come back.

### Incremental Delivery

1. Phases 1–2 → every item says whether it is finished, and nothing stored it
2. + US1 → **MVP**, validate with B1–B5 and B7
3. + US2 → the unbounded-growth report, validate with B8, B9, B10
4. + US3 → validate with B6
5. + Polish → B11–B15, and the SC-006 proof

**US2 can be pulled forward** if the unbounded list is hurting now: it depends only
on Setup, and nothing in it touches the item projection.

### What to watch for

**Something storing finishedness.** It is the one failure that would not show up as
a broken test today and would show up months later as an item filed under a state
that no longer exists. T008 and gate 4 are the guard, and they are not optional
polish.

**The renderer becoming a second judge.** `terminal` arrives as a boolean and must
stay one. The moment a component compares a state id, counts states, or infers
finishedness from progress, Principle II has been lost in a feature whose entire
subject is a lifecycle property. T042 is the check.

**The fifth URL key.** See T019. 003 shipped exactly this defect, and the shape of
the mistake is that it looks like it works.

---

## Notes

- `[P]` means a different file with no dependency on incomplete work
- Every task names its file path and, where a constraint is involved, quotes it
- No task in this feature touches `src/providers` or `src/preload`
- This feature **does** edit 001's `ItemList` fixtures, unlike 003 — one line, to
  supply a new required field. Recorded in Path Conventions so it is not misread
- Commit after each task or logical group; record any principle deviation in the
  commit message with the simpler alternative that was rejected
