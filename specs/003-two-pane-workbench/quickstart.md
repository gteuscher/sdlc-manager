# Quickstart & Validation Guide: Two-Pane Workbench

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-12

How to exercise the workbench and prove it works. No new command, no new
dependency, no new fixture — this feature re-arranges what
[001](../001-sdlc-work-item-dashboard/quickstart.md) already delivers.

---

## Prerequisites

The dashboard from 001, and a fixture with several items including some needing
attention:

```powershell
npm run fixture:create -- ./tmp/demo
$env:SDLC_PACKAGE_PATHS = "C:\dev\sdlc-manager\tmp\demo\sdlc"
npm run dev
```

Register `./tmp/demo` from the repositories view.

---

## Validation scenarios

### W1 — Both at once *(Story 1 · SC-001)*

1. Open the dashboard and select an item.

**Expected**: the item list stays on the left and the detail appears on the right.
The list does not scroll, re-order, or reload. The selected item is marked in the
list. **Every other item's attention marker is still visible** while you read the
selected one — that is the whole feature, and SC-001 measures exactly it.

### W2 — One interaction to the next item *(SC-002)*

1. With one item open, select a different one.

**Expected**: the detail changes. **One click.** No step that returns to a list
first, and the list's scroll position is where you left it.

### W3 — Nothing selected *(FR-006)*

1. Open the dashboard without selecting anything.

**Expected**: the detail pane carries copy explaining what selecting an item does.
Not an empty region, not a spinner — a deliberate "nothing" (Principle X).

### W4 — Collapsing *(Story 2)*

1. Collapse the list. 2. Expand it again. 3. Quit and reopen.

**Expected**: collapsing gives the width to the detail; **the collapsed rail still
says how many items need you** (FR-009); expanding restores the same scroll
position and selection; and the collapse state is still as you left it after a
restart (FR-011). Do all of it by keyboard alone — the control must be reachable
and operable in both states (FR-012).

### W5 — Filtering does not disturb the work *(Story 3 · FR-014, FR-015)*

1. Select an item. 2. Apply a filter that **excludes** it.

**Expected**: the list narrows; **the detail still shows the item you were
reading**; the list conveys that your selection is not currently listed. Clearing
the filter brings it back into the list with the selection intact.

### W6 — The parameter collision is gone *(research.md §2)*

1. Filter the list by state. 2. Change the detail's tab.

**Expected**: they do not interfere. The filter is `?state=`, the tab is `?tab=`,
and moving one leaves the other alone. **Before this feature these were the same
key** — this scenario exists because the collision would otherwise be introduced
silently.

### W7 — Returning directly *(FR-007, FR-016)*

1. Arrange a filter, a selection and a tab. 2. Copy the URL, reload into it.

**Expected**: the same arrangement. Selection, filters, search and tab all restore;
collapse restores from the local preference rather than the URL.

### W8 — Narrow window *(FR-017 · SC-007)*

1. Drag the window narrow.

**Expected**: one pane at a time, with a control to move between them. **Neither
pane is ever squeezed to an unusable width.** Widening restores both.

### W9 — Independent failure *(FR-019)*

1. With an item selected, make its artifact unreadable (delete a fixture markdown
   file) and refresh.

**Expected**: the detail reports what failed, in place, with a retry, **and the
list keeps working** — you can select another item without reloading.

### W10 — Nothing was lost *(FR-021 · SC-004)*

Re-run 001's scenarios **V1 through V5** against the workbench.

**Expected**: every one still passes. Attention-first ordering, the two visibly
distinct markers, the attention count, unmapped items showing their raw value,
provider disagreement surfaced, stale items marked with a retry, state tabs in
lifecycle order opening on the current state, gates distinguishing passed from
failed from not evaluated, artifacts with provenance, and the advisory console.

**This is the scenario that matters most.** A re-shaping of this size loses
behaviour by omission, and a lost marker looks like a tidier interface rather than
a regression. If any of V1–V5 fails, the feature is not done.

### W11 — Scale *(SC-005)*

```powershell
npm run fixture:create -- ./tmp/scale --items 220
```

**Expected**: with 200+ items in the list **and** a detail open, identifying what
needs you still takes under ten seconds.

### W12 — Keyboard only *(SC-006)*

1. Without touching the mouse: reach the list, move through items, select one,
   move into the detail, operate its tabs, collapse the list, expand it.

**Expected**: all of it works, in a sensible order, with focus always visible.
**Selecting an item must not move focus into the detail** — an engineer arrowing
through the list is reading, not committing.

---

## Gate coverage

No new gate. `npm run verify` runs the same nine, and this feature adds cases to
three:

| Gate | What this feature adds |
|---|---|
| 1 Green suite | `Workbench.test.tsx` — simultaneity, selection without disturbance, collapse, filter independence |
| 6 Accessibility | Two named landmarks, the collapse control's `aria-expanded`, keyboard traversal, `vitest-axe` over the assembled view |
| 7 Bundle budget | The binding constraint — 139.45 KB of 150 KB before this feature starts |

The strongest signal is one the gates cannot show directly: **the component suites
for the list, tabs, gates, artifacts and console should keep passing without being
edited.** A suite that had to be adjusted to accommodate the layout means a pane
learned it was a pane, which the Structure Decision forbids.
