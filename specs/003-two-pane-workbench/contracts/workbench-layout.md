# Contract: Workbench Layout

**Status**: Draft · **Created**: 2026-09-12 · **Feature**: [spec.md](../spec.md)
**Satisfies**: FR-001 – FR-020, Constitution Principles X, XI, XIII

The UI contract for the two-pane view: what exists, what each part is called to
assistive technology, how the keyboard moves, and what happens when things go
wrong. It is written as a contract because these are the properties the component
tests assert — a shape someone can change accidentally is worth stating once.

---

## 1. Structure

```
┌────────────────────────────────────────────────────────────┐
│ banner — brand, primary navigation                         │
├──────────────────┬─────────────────────────────────────────┤
│ complementary    │ main                                    │
│ "Work items"     │ "Item detail"                           │
│                  │                                         │
│  filters/search  │   state tabs                            │
│  ─────────────   │   ───────────                           │
│  item            │   gates · artifacts · console           │
│  item ← selected │                                         │
│  item            │                                         │
│                  │                                         │
│ [collapse]       │                                         │
└──────────────────┴─────────────────────────────────────────┘
```

Both panes are always present in the accessibility tree while the window is wide
enough for both (§5). The banner is outside both, so navigating between views does
not disturb either pane.

## 2. Landmarks and names

| Region | Role | Accessible name | Notes |
|---|---|---|---|
| Header | `banner` | — | Brand and primary navigation. Unchanged from today. |
| List pane | `complementary` | "Work items" | Named, because a page with two unnamed regions tells a screen-reader user nothing about which is which. |
| Detail pane | `main` | "Item detail" | Exactly one `main` per view. |
| Collapse control | `button` | "Hide the work item list" / "Show the work item list" | `aria-expanded` reflects the state; `aria-controls` names the pane. |

The list is `complementary` rather than `navigation` deliberately: it is a list of
work with status, not a set of links to sections of the page, and calling it
navigation would misdescribe it to anyone relying on landmark jumps.

## 3. Selection

1. Selecting an item changes **only** what the detail pane renders. The list is
   not unmounted, not re-ordered, and not scrolled (FR-004).
2. The selected item is marked in the list in a way that does not rely on colour
   alone, and carries `aria-current` (FR-005).
3. **Selection does not move focus.** An engineer moving through the list by
   keyboard is reading; taking focus into the detail on each selection makes the
   list unusable. Focus moves only when the engineer asks for it.
4. With nothing selected, the detail pane renders deliberate copy saying what
   selecting will do — never an empty region (FR-006, Principle X).

## 4. Collapsing

1. Collapsing hides the list's content and gives its width to the detail (FR-008).
2. A collapsed pane **still reports that items need attention, and how many**
   (FR-009). A rail that hides the one signal the workbench exists to surface has
   defeated its own purpose.
3. Expanding restores scroll position and selection (FR-010).
4. The control is reachable and operable by keyboard in **both** states (FR-012).
   A pane collapsed to nothing must not take its own expand control with it.
5. The state persists across navigation and restarts (FR-011), stored as described
   in [data-model.md](../data-model.md).

## 5. Narrow windows

Below the width at which two panes are both usable, exactly one pane is shown at a
time, with an explicit control to move between them (FR-017).

- No threshold is specified here. SC-007 states the property — no pane is ever
  rendered unusably narrow — and the number is a design decision made against real
  content.
- In single-pane mode the URL still determines what is shown: `/` shows the list,
  `/items/:key` shows the detail with a control back to the list. Nothing new is
  remembered.
- Squeezing both panes is not an acceptable degradation. Simultaneity that needs
  horizontal scrolling in both columns has already been lost, and the honest
  fallback is one thing at a time.

## 6. Failure, independently

1. Each pane reports its own failure **in place**, with a retry (FR-019).
2. A failure in one pane does not blank the other. Each pane carries its own error
   boundary rather than sharing one; a thrown render in the detail leaves the list
   usable, and the engineer can select something else.
3. A selected item that no longer exists produces a named message and a way back,
   not a blank pane (FR-018).
4. A deep link arriving before the list has loaded shows a bounded pending state in
   the detail pane (FR-020) — bounded, because Principle X forbids a spinner
   without a timeout.

## 7. What this contract does not govern

- **Widths, colours, spacing, and the collapse threshold.** Design decisions. The
  reference project's 224px rail is a starting point recorded in the spec's
  Assumptions, not a requirement.
- **Anything about lifecycles.** No state, gate, transition or provider name
  appears in the layout, and the lint rule forbidding that vocabulary in
  `src/renderer` continues to apply (FR-023).
- **The repositories view**, which remains a separate view reached from the banner
  (FR-022).
- **Nesting within the list.** Feature
  [002](../../002-work-item-hierarchy/spec.md) adds that, and is sequenced after
  this one because it nests inside the pane this contract creates.
