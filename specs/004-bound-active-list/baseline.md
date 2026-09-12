# Baseline: Bounding the Active List

**Recorded**: 2026-09-12, before any file in this feature was touched (T001, T002)
**Feature**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)

Two things are measured here, because this feature has two failure modes that
would not announce themselves. It changes **which items are listed**, which is the
change most able to drop an ordering rule or a marker while looking tidier for it
(SC-006). And its central claim is that finishedness is **derived, never stored** —
a claim that breaks silently and surfaces months later as an item filed under a
state that no longer exists.

---

## 1. Test suite, before (T001)

`npx vitest run` — **33 files, 660 tests, all passing.**

The suites SC-006 requires to still pass, and what this feature is expected to do
to each:

| Suite | Tests | Expected change |
|---|---:|---|
| `tests/component/ItemList.test.tsx` | 15 | **+1 fixture line** (T006), plus new cases for the control |
| `tests/component/Workbench.test.tsx` | 17 | **+1 fixture line** (T006), plus new cases |
| `tests/component/Repositories.test.tsx` | 23 | **+1 line per package fixture** (T031), plus the report |
| `tests/component/StateTabs.test.tsx` | 10 | **none** |
| `tests/component/GateList.test.tsx` | 8 | **none** |
| `tests/component/ArtifactPanel.test.tsx` | 8 | **none** |
| `tests/component/Markdown.safety.test.tsx` | 4 | **none** |
| `tests/component/Console.test.tsx` | 10 | **none** |
| `tests/component/usePaneState.test.tsx` | 13 | **none** |
| `tests/component/RouteErrorBoundary.test.tsx` | 9 | **none** |
| `tests/unit/items.aggregate.test.ts` | 14 | new cases (T007, T009) |
| `tests/unit/cache.rebuild.test.ts` | 14 | **+1 fixture line**, plus the derived-not-stored case (T008) |
| `tests/unit/boot.zero-config.test.ts` | 16 | new case (T024) |
| remaining `tests/unit/**`, `tests/parity/**` | 499 | **none** |

**Unlike 003, fixture edits are expected here** and are not a regression. Adding a
required field to a wire type obliges the helpers that construct one to supply it.
The line to watch is different: **a suite needing a change beyond supplying a new
field is a finding** (T038).

### The pre-existing flake, still on the record

`StateTabs.test.tsx › moves between tabs with the arrow keys` failed once during
003 under parallel load, with focus having moved and selection not yet caught up.
It did not reproduce across the many full runs since, including this one. It
predates 003 and is unrelated to this feature. A *reproducible* failure there is a
finding; a single one under load is that flake.

## 2. Bundle, before (T002)

`npm run build && npx size-limit`

| Budget | Limit | Before | Headroom |
|---|---:|---:|---:|
| **Initial JS (gzip)** | 150 KB | **141.06 KB** | **8.94 KB** |
| Lazy route: markdown artifact (gzip) | 60 KB | 49.66 KB | 10.34 KB |
| Total application JS (gzip) | 400 KB | 190.72 KB | 209.28 KB |
| Initial CSS (gzip) | 20 KB | 5.89 KB | 14.11 KB |

research.md §7 projects **~141.8 KB** after this feature, leaving ~8.2 KB. The
budget is the tightest gate again, and the response to a failure is to trim or to
move `Items` behind a lazy boundary — **not** to raise the number.

## 3. The Principle II boundary, before (T002)

`grep -rn "terminal" src/renderer` — **three hits, none of them a decision:**

```
components/RouteErrorBoundary.tsx:51  // a comment about a shell terminal
routes/ItemDetail.css:123             .tag--terminal   (a class name)
routes/ItemDetail.tsx:142             {state.terminal ? … "Final state" …}
```

Only the third reads lifecycle data, and it **reads** `StateView.terminal` — a
boolean the main process already derived — to render a label. It decides nothing.

This is the shape every hit must still have afterwards (T042). The renderer may
read `terminal`; it may not compare a state id, count states, or infer
finishedness from progress. plan.md's boundary test: **grep afterwards, and every
hit should be reading the field, never deciding it.**

---

## 4. Results, after

*Filled in by T038, T039, T041 and T042.*

### T038 — SC-006, the 001 and 003 suites

**Result: nothing was withdrawn. 660 → 690 tests, and not one existing assertion
was rewritten.**

`npx vitest run` — **33 files, 690 tests, all passing.** (688 at the time this was
first measured; T039's walkthrough then found a defect and added two regression
tests for it.)

`git diff --stat tests/` — **1308 insertions, 3 deletions.** The deletions are the
whole story, so here they are in full:

```
tests/component/ItemList.test.tsx   (1)
-import { render, screen, within } from '@testing-library/react';

tests/component/Workbench.test.tsx  (2)
-  return createBridgeStub({
-    listItems: () => Promise.resolve(items),
```

The first is an import line widened to add `cleanup` and `waitFor`. The other two
are a harness fix explained below. **No assertion in any pre-existing test was
changed, weakened, or removed**, and five suites — `StateTabs`, `GateList`,
`ArtifactPanel`, `Markdown.safety`, `Console` — took no edit at all beyond the
single fixture line the new required field obliges.

| Suite | Before | After | Nature of the change |
|---|---:|---:|---|
| `ItemList.test.tsx` | 15 | 21 | +6 tests, +1 fixture line, 1 import widened |
| `Workbench.test.tsx` | 17 | 23 | +6 tests, +1 fixture line, harness fix (below) |
| `Repositories.test.tsx` | 23 | 27 | +4 tests, +1 line per package fixture |
| `items.aggregate.test.ts` | 14 | 24 | +10 tests, insertions only |
| `boot.zero-config.test.ts` | 16 | 20 | +4 tests, insertions only |
| `cache.rebuild.test.ts` | 14 | 14 | +1 line in `comparable()` — **this is T008** |
| `StateTabs.test.tsx` | 10 | 10 | +1 fixture line |
| everything else | 551 | 551 | untouched |

**The fixture edits are the expected ones**, and §1 predicted them: a required
field on a wire type obliges the helpers that build one to supply it. The line
this task actually watches — *a suite needing a change beyond supplying a new
field* — was not crossed.

#### One finding, and it is about 003's tests rather than this feature's code

`createBridgeStub` tracks calls only for the methods it implements itself; an
override replaces the tracking along with the answer. `fleetBridge` in
`Workbench.test.tsx` overrides both `listItems` and `getItem`, so **`stub.calls`
was permanently empty in that file** — and 003's three "was not re-fetched"
assertions were comparing `0` to `0`. They passed regardless of what the
implementation did.

The two deleted lines above are the fix: the overrides now push into `stub.calls`,
and the new T013 guards its own use with `expect(before).toBeGreaterThan(0)` so it
cannot go vacuous the same way. **The three pre-existing assertions still pass with
real counting**, so 003's implementation was correct all along — only the proof was
missing.

This is the fourth time this project has produced an assertion that passes without
testing its claim: 001's spec satisfied every requirement while not building the
described product; 003's T030 was true while the tab silently reverted; 004's first
FR-002 test asserted a control existed rather than what it said; and now this. The
pattern is worth a rule of its own — recorded in the design review.

### T039 — quickstart B1–B15

**Result: 13 pass, 2 partial, and two real defects — one fixed, one left open with
a requirement recorded as unmet.**

Walked against a **built** application over four independent user-data workspaces:
an ordinary two-lifecycle fixture, an `--omit-terminal` package beside a
hand-edited all-terminal one, an all-items-finished fixture, and an
`upgrade --remove-state` fixture. 24 checks, driven through Playwright rather than
asserted from memory.

| Scenario | Verdict | Observed |
|---|---|---|
| B1 reachable | **PASS** | 12 active rows → 14 ticked; arrivals `DEMO-107` and `LAB-206`, both `row--finished`; unticking restored the identical 12 keys in order |
| B2 discoverable, no count | **PASS** | The only visible text matching `/finish/i` anywhere on the page is `"Show finished work"`. No count, no existence claim |
| B3 opening a finished item | **PASS** | 6 tabs, 5 gates, 6 artifacts, 1 console — identical treatment to an active item |
| B4 detail undisturbed | **PASS** | Detail polled every 60 ms across a tick/untick cycle; only ever `DEMO-103` |
| B5 filters narrow it | **PASS** | 2 finished → repository filter → 1 → search → 1, still `row--finished` |
| B6 the arrangement is a link | **PARTIAL** | The address restores all four correctly — but the scenario's own order could not *produce* it, because of the defect below |
| B7 the collision | **PASS on 3 of 4 write paths** | Select, search keystroke and Clear filters all clean. **The row link was the fourth and it was broken** |
| B8 no-terminal reported | **PASS** | "NEVER FINISHES — … declares no final state"; package still tagged Usable, registered through the form, all 8 items listed and openable |
| B9 correcting the package | **FAIL** | See below — **FR-013 is not met** |
| B10 every state terminal | **PASS** | "FINISHES INSTANTLY — Every state Lab Research Pipeline declares is final"; all 6 items absent until the box is ticked |
| B11 unmapped not swept in | **PASS** | Unmapped items list as `row--unmapped` showing raw `review`, never `row--finished`, before or after ticking |
| B12 reopened returns | **PASS** | Editing `status: done → review` in the system of record returned it within one reconciliation, no action in the app |
| B13 everything finished | **PASS** | 0 rows, "No active work items", the finished hint — **and the control is on screen and works.** The dead end found during implementation is fixed and the fix holds in the built app |
| B14 nothing lost | **PARTIAL** | V1–V5 ✓, V9 read-only ✓, W1/W3–W8/W11/W12 ✓. **W2 failed** on the same defect as B7. V5's invalid-save half not automatable |
| B15 scale | **PASS** | `scale.spec.ts` 7/7 including SC-007 with finished work included |

#### Defect 1 — the fourth write path. Found here, fixed, and now tested

The list writes its query string from three controls and **navigates away from it
by a fourth**: the row link. `ItemRow` used `to={`/items/${key}`}` — a bare string,
which React Router treats as a whole location and which therefore discards the
query string entirely.

```
before:  #/?repository=a-demo&q=DEMO-10&finished=1     8 rows, box ticked
after clicking a row:  #/items/DEMO-107               12 rows, box unticked
```

`FILTER_PARAMS`' careful key-by-key discipline in `Items.tsx` was bypassed
completely. `ItemDetail`'s back link had the same shape, so returning to the list —
the *only* route back at narrow widths — dropped everything too.

**This is 003's collision defect through the other door.** 003 fixed the list
clobbering the detail's `?tab=`; nobody checked the detail *link* clobbering the
list's keys. It went unnoticed for a release because until 004 the lost keys were
only filters, which look like a list the engineer had already changed. The finished
flag is the one whose loss changes *what the list contains* — 14 rows to 12, under
the cursor, at the exact moment of reaching for one. That broke 003's W2 promise.

**Fixed**: the list now supplies its own keys to each row (`search` prop — the row
still reads no route), and the back link preserves everything except the `?tab=`
that described an item no longer open. **Two regression tests added**, both
verified against a negative control: reverting the row link makes them fail.

The rule the two halves now state together: **the list writes only its own keys,
and carries only its own keys.**

#### Defect 2 — FR-013 is not met, and is not fixed here

**Expected** (FR-013, B9): correcting a package so it declares a terminal state
clears the report and lets its items leave the active list "with no action in this
application beyond the next reconciliation".

**Observed**: 45 seconds after writing `terminal: true` into the registered
repository's own `sdlc/sdlc.yaml`, the "Never finishes" report was still on screen
and the item was still listed as active. Only a full restart cleared both.

**Cause**: `reconcileRepository` in `src/main/reconcile/index.ts` re-reads items
but never re-scans packages. `packages = await scan(...)` happens only in
`reload()`, which runs at `start()`, on registry mutations (register, update
config, remove, set credential), and on an **unscoped** `refresh({})` that no UI
control invokes. The repository's own watcher does fire on the manifest — so the
application reconciles, against the definition it loaded at startup.

**Why it is not fixed in this feature.** It is pre-existing: packages have always
been scanned at start and on registry mutations only, and any manifest edit has
always been stale until restart. 004 did not introduce it; FR-013 is simply the
first requirement to depend on it. Fixing it properly means deciding *when* a
package re-scan should happen — on every watched change, or only for manifest
paths, and what to do about a half-written file mid-save — which is a design
decision in the reconcile loop, a layer this feature's plan deliberately did not
scope. Making that call unreviewed at the end of an implementation phase is how
the reconcile loop acquires behaviour nobody specified.

So it is recorded rather than patched, and **FR-013 stands unmet**. The
requirement is not weakened to match the code: it is right, and the code does not
yet do it.

#### Smaller findings

- **Fixed**: with finished work included and a filter matching nothing, the empty
  state read "None of the 14 **active** items match…" — counting the finished ones
  the same feature insists are not active. It now says "listed" when finished work
  is shown.
- **Not automatable**: V5's invalid-save half. Neither stock fixture declares a
  `repo_config` field that can hold an invalid value — both are optional strings
  with defaults — so "save an invalid value, see it rejected naming the field"
  cannot be walked as written. This is the same gap 003's T042 recorded and it is
  still open.
- **Pre-existing, unrelated to 004**: a deleted artifact does not update in place
  (an `items` change event never invalidates the `artifact` query, in
  `applyChangeEvent`); V4 passes only on refresh, which is what the scenario says
  to do. Package discovery also lists each fixture's `.claude-plugin` subdirectory
  as an "Unsupported" package.
- **Human observations still outstanding**: whether the arrangement is
  *comfortable* at any width, and whether a human actually identifies what needs
  them inside ten seconds. Both were measured for everything that would make them
  impossible; neither can be claimed.

### T041 — bundle, after

**Result: pass, 0.18 KB under the projection. The budget was not raised.**

| Budget | Limit | Before | After | Change |
|---|---:|---:|---:|---:|
| **Initial JS (gzip)** | 150 KB | 141.06 KB | **141.77 KB** | **+0.71 KB** |
| Lazy route: markdown artifact | 60 KB | 49.66 KB | 49.66 KB | **unchanged** |
| Total application JS | 400 KB | 190.72 KB | 191.42 KB | +0.70 KB |
| Initial CSS | 20 KB | 5.89 KB | 6.00 KB | +0.11 KB |

research.md §7 projected **~141.8 KB**; the final figure is **141.77 KB**, leaving
**8.23 KB** of headroom against the ~8.2 KB predicted — within 0.03 KB. Two
features running have now landed inside 0.2 KB of their estimate, so that table's
per-component figures are worth trusting for the next one.

(Measured at 141.62 KB before the two link fixes under T039; those added 0.15 KB.)

The spend came in under estimate for a reason worth noting: the repositories
view's share — the `PackageRelease` component and its copy, the largest single
addition — lands in `Repositories.js`, which is behind its own lazy boundary and
outside the initial budget.

**The markdown chunk is byte-identical at 49.66 KB.** No contingency was needed:
`Items` did not have to move behind a lazy boundary, and the 150 KB number was not
touched.

### T042 — the Principle II boundary, after

**Result: the boundary holds. Every hit reads; none decides.**

`grep -rn "terminal" src/renderer` — six code hits and several in prose:

| Location | What it does | Verdict |
|---|---|---|
| `components/ItemRow.tsx` ×2 | reads `item.terminal`, a boolean the main process decided | **read** |
| `routes/ItemDetail.tsx` | reads `state.terminal` (pre-existing, unchanged) | **read** |
| `routes/Repositories.tsx` ×2 | compares `summary.terminalStateCount` against `0` and against `stateCount` | **read** — see below |
| `components/RouteErrorBoundary.tsx` | a comment about a shell terminal | not lifecycle |
| `routes/ItemDetail.css` | the `.tag--terminal` class name | not lifecycle |

**Nothing in the renderer evaluates whether a state is terminal.** No component
compares a state id, counts a definition's states, or infers finishedness from
progress. The two comparisons in `Repositories.tsx` are the view interpreting two
numbers the main process derived, which is what research.md §4 specified when it
chose a count over a boolean — and neither names a state, so the lint rule
forbidding lifecycle vocabulary in the renderer passes unchanged.

Against the §3 baseline this is three new code hits, all of the same shape as the
one that was already there.
