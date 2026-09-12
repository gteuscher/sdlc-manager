# Quickstart & Validation Guide: Work Item Hierarchy

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-11

How to exercise the hierarchical list and prove it works. Every scenario runs
offline against a fixture — none needs a Jira instance or a network.

That is deliberate and is the point of the whole design: if these scenarios needed
Jira, the feature would have been built as a Jira feature rather than as a declared
lifecycle capability.

---

## Prerequisites

The dashboard from [001](../001-sdlc-work-item-dashboard/quickstart.md), installed
and running. No new dependency, no new command.

## Fixture

```
npm run fixture:create -- ./tmp/nested --sdlc nested
```

Creates a repository whose lifecycle declares `items.hierarchy` at contract v2: two
parents, one with three children and one with none, plus a child whose parent is not
in the list and a deliberately broken pair that reference each other.

Point package discovery at it and start the app:

```powershell
$env:SDLC_PACKAGE_PATHS = "C:\dev\sdlc-manager\tmp\nested\sdlc"
npm run dev
```

Register `./tmp/nested` from the repositories view.

---

## Validation scenarios

Each maps to user stories and success criteria in the spec. Their automated
equivalents live in `tests/`.

### H1 — Nesting *(Story 1 · SC-008)*

1. Observe the item list.

**Expected**: the parent with three children renders as **one collapsed row** with a
child count and an expander. Expanding reveals exactly those three children, each
with its own state. Collapsing hides them and leaves the parent. The childless
parent renders as an ordinary row with **no expander at all** — not a disabled one,
and not an empty group.

### H2 — A flat lifecycle is untouched *(SC-005)*

1. Register `./tmp/demo` (the lifecycle from 001, contract v1) alongside.

**Expected**: its items render exactly as before — no expanders, no indentation, no
change of any kind. Both lifecycles appear in one list, each presented according to
its own declaration. **Any visible change to the flat list is a regression**, not a
consequence of this feature.

### H3 — Something inside needs me *(Story 2 · SC-001, SC-002)*

1. Collapse everything.

**Expected**: the parent containing the awaiting-input child carries a **descendant**
marker. The parent that itself awaits input carries an **own** marker. The two are
**visibly different in greyscale** — different words and different shapes, not two
colours. Identifying every group containing work that needs you takes under ten
seconds **without expanding anything**.

2. Expand the marked parent.

**Expected**: the specific child carrying the signal is identifiable without
inspecting each one.

### H4 — Both at once *(FR-013)*

1. Find the parent that awaits input *and* contains a failed-gate child.

**Expected**: **both** facts are conveyed. Neither masks the other. This is the case
a single-badge implementation gets wrong while still looking correct.

### H5 — The count does not lie *(FR-015 · SC-004)*

1. Note the attention count. Expand everything and count the marked rows yourself.

**Expected**: the count equals the number of **distinct owned items** needing
action. A parent carrying only a rolled-up marker is **not** counted. A parent that
needs you *and* contains a child that needs you counts as **two** — two items, not
three.

### H6 — Context items *(FR-020, FR-021, FR-021a)*

1. Look at the parent whose children belong to someone else, and at the child whose
   parent is not yours.

**Expected**: the non-owned items are shown and **visibly marked as not yours**,
distinguishably in greyscale. They contribute nothing to the attention count, and
carry no marker implying you are being asked to act.

### H7 — Broken relationships *(FR-022, FR-023, FR-024)*

1. Look at the orphaned child and the mutually-referencing pair.

**Expected**: the orphan appears as a **root**, reporting that its parent could not
be resolved and naming the key. The cycle members each appear as roots, reporting
the cycle. **Nothing disappears**, and the rest of the list renders normally. The
application does not hang.

### H8 — Working the tree *(Story 3)*

1. Expand two groups, apply a state filter matching only nested children, then
   navigate to an item and back.

**Expected**: matching children are shown with their parents as context. The
expansion arrangement is restored. The URL reflects it, so the arranged view can be
returned to directly.

### H9 — Scale *(SC-006, SC-007)*

```
npm run fixture:create -- ./tmp/nested-big --sdlc nested --items 220
```

**Expected**: 200+ items with 50+ nested still complete H3 within ten seconds.
Expanding a 200-child parent leaves the rest of the list usable; children beyond the
render cap are **counted, not silently dropped**.

### H10 — The contract version is enforced *(rule 16 · FR-047)*

1. Edit the fixture's `sdlc.yaml`, changing `sdlc: 2` to `sdlc: 1` while leaving
   `items.hierarchy` in place.

**Expected**: the package is reported as **unsupported**, naming the offending field
*and* the version. Not partially loaded, and not loaded with the hierarchy silently
ignored.

### H11 — Still read-only *(FR-034 · SC-011)*

1. Run H1–H10 against a version-controlled fixture, then `git -C ./tmp/nested status`.

**Expected**: **no modifications.** Nesting is a view over data that is read; nothing
about this feature writes.

---

## Gate coverage

No new gate. `npm run verify` runs the same nine, and this feature adds cases to
four of them:

| Gate | What this feature adds |
|---|---|
| 1 Green suite | Tree building, cycle detection, roll-up, ownership — all pure, all offline |
| 5 Provider parity | Hierarchy cases run against every provider fake unmodified |
| 6 Accessibility | The disclosure group: `aria-expanded`, keyboard operation, `vitest-axe` |
| 7 Bundle budget | The binding constraint — ~13 KB of headroom before this feature starts |
