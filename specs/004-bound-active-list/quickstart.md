# Quickstart & Validation Guide: Bounding the Active List

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-12

How to exercise finished work and prove it works. No new command and no new
dependency. One fixture gap has to be closed first, and that is itself part of the
feature — see below.

---

## Prerequisites

The dashboard from 001 and the workbench from 003, plus a fixture with items in a
terminal state:

```powershell
npm run fixture:create -- ./tmp/demo
$env:SDLC_PACKAGE_PATHS = "C:\dev\sdlc-manager\tmp\demo\sdlc"
npm run dev
```

Register `./tmp/demo` from the repositories view.

The default fixture's lifecycle declares a final state, so some of its seeded items
are already finished and are **not** in the list before this feature is built —
which is the defect, and the starting point for B1.

### A fixture this feature must add

No stock fixture declares a lifecycle with **no** terminal state, so User Story 2
cannot be walked at all today. Producing one is part of the work, not a step in
this guide. The shape it needs: the default lifecycle with `terminal: true`
removed from its final state, and nothing else changed, so the only variable is
the one under test.

---

## Validation scenarios

### B1 — Finished work is reachable *(Story 1 · SC-001)*

1. Open the workbench and note which items are listed.
2. Include finished work.

**Expected**: items appear that were not there before, each marked as finished in
a way that survives greyscale, each naming the state it finished in. Excluding
again returns the list to exactly what it was. **Before this feature there is no
control here at all** — that is what B1 is checking has changed.

### B2 — Finished work is discoverable *(FR-002 · SC-002)*

1. Open the workbench having never seen this feature.

**Expected**: something on screen says finished work is not being shown, without
the engineer knowing to look for it. There is deliberately **no count** — see
[research.md §5](research.md) — so what is being checked is that the control is
visible and says what it does, not that a number is right.

### B3 — Opening a finished item *(FR-004)*

1. Include finished work and select a finished item.

**Expected**: the detail pane shows it exactly as it shows an active item — its
states, gates, artifacts, provenance and console. Nothing is withheld because the
work is over; the point of looking is usually to read what happened.

### B4 — The detail is not disturbed *(FR-005 · SC-008)*

1. Open any item. 2. Include finished work, then exclude it again.

**Expected**: the detail pane keeps showing the same item throughout. This is 003's
FR-014 rule applied to a new control, and it is the one most likely to be broken by
a well-meaning refetch.

### B5 — Filters narrow finished work too *(FR-006)*

1. Include finished work. 2. Apply a repository filter, then a search.

**Expected**: both narrow the finished items the same way they narrow active ones.
Finished work is more of the same list, not a second list.

### B6 — The arrangement is a link *(FR-007 · Story 3)*

1. Include finished work, apply a filter and a search, and open an item.
2. Copy the URL, reload into it.

**Expected**: all four restore together — inclusion, filter, search and selection.
An address that does not mention finished work excludes it.

### B7 — The list's keys and the detail's key still do not collide *(003's W6)*

1. Include finished work and open an item on a state tab that is not its current
   one. 2. Change a filter. 3. Clear the filters.

**Expected**: the open tab is untouched throughout, and the inclusion flag survives
a filter change but is cleared by "Clear filters" along with the other filters.
**003 shipped a defect here** — the list rebuilt the whole query string and erased
the detail's tab — so a fifth list-owned key is exactly the change that could
reintroduce it.

### B8 — A lifecycle that never releases work is reported *(Story 2 · SC-004)*

1. Install the no-terminal-state fixture described above and register it.

**Expected**: the repositories view reports it, **names the package**, says the
consequence — items following this lifecycle never leave the active list — and says
the correction belongs in the package. The repository still registers, its items
still appear, and they are all openable. **A refusal here is a failure**, not a
stricter reading (FR-012).

### B9 — Correcting the package clears the report *(FR-013)*

1. Add `terminal: true` to that fixture's final state. 2. Let it reconcile.

**Expected**: the report is gone, and items in that state have left the active
list, with nothing done inside the application.

### B10 — Every state is terminal *(FR-014)*

1. Mark every state of a fixture lifecycle terminal.

**Expected**: reported on the same terms as B8 — its items never appear as active,
which is just as broken and just as silent.

### B11 — Unmapped work is not mistaken for finished *(FR-015)*

```powershell
npm run fixture:upgrade -- ./tmp/demo
```

**Expected**: an item whose recorded state no longer exists stays in the **active**
list showing its raw recorded value, and is not swept into finished work. Whether
it is finished is unknowable, and the answer that hides it would be a guess.

### B12 — Reopened work returns *(FR-017 · SC-005)*

1. With an item finished, edit its system of record so it rests in an earlier
   state. 2. Let it reconcile.

**Expected**: it is back in the active list, with nothing done inside the
application and no cache cleared. This is the payoff for deriving finishedness
rather than recording it.

### B13 — Everything is finished *(Edge case)*

1. Move every item in a repository into its terminal state.

**Expected**: the active list is empty and says so in a way that distinguishes
"nothing is in flight" from "nothing is here", and points at the finished work.
An engineer must not be able to conclude their repository is broken.

### B14 — Nothing was lost *(FR-018 · SC-006)*

Re-run 001's scenarios **V1–V5** and 003's **W1–W12**.

**Expected**: every one still passes. This feature changes which items are listed,
which is exactly the change that quietly drops an ordering rule or a marker. The
003 baseline is in
[003's baseline.md](../003-two-pane-workbench/baseline.md) and is the comparison.

### B15 — Scale, with finished work included *(SC-007)*

```powershell
npm run fixture:create -- ./tmp/scale --items 220
```

**Expected**: with 200+ items and finished work shown, identifying what needs you
still takes under ten seconds. Attention-first ordering is doing the work: a
terminal state never raises attention, so finished items sort below everything
waiting on the engineer and the list grows *away* from what is being looked for.

---

## Gate coverage

No new gate. `npm run verify` runs the same nine, and this feature adds cases to
four:

| Gate | What this feature adds |
|---|---|
| 1 Green suite | The projection's `terminal` derivation, the filter's `includeTerminal` branch, the package's `terminalStateCount`, and the list's control |
| 2 Typecheck and lint | Three wire fields; the lifecycle-vocabulary rule must still pass, since neither new condition names a state |
| 4 Cache-rebuild | Finishedness is derived, so a rebuilt cache must reproduce it identically — the sharpest available check that nothing recorded it |
| 7 Bundle budget | 141.06 KB of 150 before this feature starts; ~8.2 KB projected to remain |

Gate 4 is worth singling out. Deriving rather than storing is this feature's
central claim, and the cache-rebuild test is the one gate that would notice if a
`terminal` value were ever written down: a rebuilt cache that disagrees with the
definition is precisely the failure the claim is meant to prevent.
