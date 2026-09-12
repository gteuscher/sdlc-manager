# Phase 0 Research: Two-Pane Workbench

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-12

Every decision below is checked against constitution v2.1.0. Two constraints bind
this feature: Principle XII (≈10.5 KB of bundle headroom) and Principle XI (two
persistent panes are harder to make keyboard-operable than two pages).

---

## 1. How the two panes come to be rendered together

**Decision**: A parent layout route that renders the list pane and an outlet, with
the detail as its child route. URLs are unchanged.

```
/                 → Workbench, outlet shows the no-selection pane
/items/:key       → Workbench, outlet shows ItemDetail
/repositories     → Repositories, unchanged (FR-022)
```

**Rationale**: This is the smallest change that satisfies FR-001 and FR-004
together. The list is mounted by the parent, so selecting an item changes only
what the outlet renders — the list is not unmounted, not re-rendered from scratch,
and does not lose its scroll position. FR-004's "without replacing, reloading, or
repositioning the list" is then a property of where the component is mounted
rather than something the code has to remember to preserve.

It also keeps every existing URL working, which matters more than it looks:
FR-007 and 001's FR-015 both require a particular item and state to be returnable
directly, and `001`'s tests assert it.

**Alternatives considered**: *One route rendering both panes and reading the key
from a query parameter* — would change every existing URL and invalidate 001's
navigation tests for no gain. *Keeping two routes and rendering the list in the
shell for both* — the list would then be outside the router's control, so the
"which item is selected" highlight would have to be threaded manually.

---

## 2. The `?state=` collision — a bug this feature would otherwise introduce

**Decision**: Rename the detail pane's tab parameter from `?state=` to `?tab=`.

**Rationale**: This is the one thing that must be fixed before anything else, and
it is invisible until the panes share a view.

- `Items.tsx` defines `PARAM_STATE = 'state'` and reads it as the **list filter**.
- `ItemDetail.tsx` defines `PARAM_STATE = 'state'` and reads it as the **selected
  tab**.

Two separate routes, one query string each, no contact. Put them in one view and
they read and write the same key: filtering the list to one state would move the
detail's tab; changing tab would silently filter the list. Both behaviours are
specified — FR-013 for the filter, 001's FR-015 for the tab — so neither can give
way, and the collision has to be resolved by naming.

The detail's parameter is the one renamed, for two reasons: `state` is the
lifecycle's own word and reads correctly for a filter over states, and the list
pane is the persistent one whose URL an engineer is more likely to share.

**Alternatives considered**: *Namespacing both* (`?list.state=`, `?tab.state=`) —
tidier in the abstract, changes two things instead of one, and makes every URL
uglier for a collision that occurs once. *Moving the tab into the path*
(`/items/:key/:tab`) — a bigger change to routing, and it makes a tab a navigation
step, which would put six history entries between the engineer and the list.

---

## 3. Where the collapse state lives

**Decision**: A browser-local preference, read once and written on change. Not the
URL; not a store.

**Rationale**: FR-011 requires the collapse state to survive navigation **and
restarts**, and the URL cannot do the second. Principle XIII says global client
state is a last resort requiring written justification, so here it is:

- It is **not domain state**. It describes the engineer's furniture, not any work
  item, and nothing derived from a system of record depends on it.
- It is **not shared**. One boolean, read by the shell and by nothing else.
- The alternatives are worse. In the URL it is lost on restart (failing FR-011)
  and pollutes every shared link with a personal preference. In the main process it
  becomes a new bridge method and a new persisted file — real cost, no gain, and a
  widening of the renderer's privilege set for a boolean about a sidebar.

Selection, filters, search and the state tab all stay in the URL, unchanged. The
dividing line is legible: **the URL holds what another person or another session
should be able to arrive at; local storage holds what only this engineer at this
desk cares about.**

Browser storage can be unavailable or throw, so the read is defensive and its
failure means "expanded" — the state in which nothing is hidden.

**Alternatives considered**: *URL only* — fails FR-011. *Main-process
persistence* — see above. *No persistence* — fails FR-011 outright, and a rail that
re-expands on every restart is precisely the friction the requirement exists to
prevent.

---

## 4. Narrow windows

**Decision**: Below a threshold, present one pane at a time with an explicit
control to move between them. The threshold lives in CSS, not in a requirement.

**Rationale**: FR-017 requires that neither pane is ever rendered unusable, and
SC-007 states the property rather than a number, deliberately — a width in the
specification would be invented. Two panes stop being workable somewhere near the
point at which the list pane can no longer show an item's identifier and its
attention marker on one line, and that is a design judgement to be made against
real content.

Presenting one at a time rather than squeezing both is the right degradation
because the workbench's value is *simultaneity*, and simultaneity that requires
horizontal scrolling in both panes has already been lost. When it cannot be had,
the honest fallback is the behaviour the product has today: one thing at a time,
with a way back.

**Alternatives considered**: *Squeeze both* — produces two unusable columns, which
FR-017 forbids in as many words. *Overlay the list above the detail* — a drawer is
a reasonable pattern, and it is a heavier interaction than this feature needs;
revisit if the single-pane mode proves awkward in use.

---

## 5. Accessibility: two panes, one keyboard

**Decision**: Each pane is its own landmark with an accessible name; the collapse
control is a real button with `aria-expanded`; tab order follows visual order, list
before detail. No focus trapping, no roving `tabindex`, no custom key handling.

**Rationale**: This is the design risk the constitution flags, and the cheapest
correct answer is to add no new keyboard model at all. Two panes side by side are
two regions of one page; the browser's own tab order already walks them in the
right sequence if the DOM order matches the visual order. Anything more
inventive — arrow keys moving between panes, focus jumping to the detail on
selection — would be a custom model that `vitest-axe` cannot verify and that
Principle XI's scope note warns a single maintainer away from.

Two details that are not optional:

- **Selecting an item must not steal focus.** An engineer arrowing down a list of
  items is reading, not committing; moving focus into the detail on every
  selection makes the list unusable by keyboard.
- **A collapsed pane must keep its expand control reachable** (FR-012). A pane
  collapsed to nothing takes its own control with it, which is a trap.

**Alternatives considered**: *A full `role="application"` keyboard model* — more
than this needs and unverifiable by the tools in the gate. *Focus moving to the
detail on selection* — see above.

---

## 6. Preserving feature 001 — the actual risk

**Decision**: Move the panes, do not rewrite them. Existing component suites are
the regression net and should keep passing **unmodified**.

**Rationale**: FR-021 lists eleven behaviours that must survive, and the failure
mode for a re-shaping of this size is that one of them quietly does not — a lost
attention marker or a dropped raw value looks like a *tidier* interface, not like a
regression, so review will not catch it. Tests will.

The strongest available signal is that `ItemList.test.tsx`, `StateTabs.test.tsx`,
`GateList.test.tsx`, `ArtifactPanel.test.tsx`, `Markdown.safety.test.tsx` and
`Console.test.tsx` continue to pass without being edited. A suite that had to be
adjusted to accommodate the new layout is evidence that a pane learned something
about being a pane, which is exactly what the Structure Decision forbids.

Where a test genuinely must change — `ItemDetail` reading `?tab=` instead of
`?state=` — the change should be one line, and its size is itself the measurement.

**Alternatives considered**: *Rewriting the list as a rail component* — would
discard the tests that are the only real guard on FR-021, in exchange for markup
that the existing component already produces.

---

## 7. Bundle budget

Against Principle XII's 150 KB initial-JS budget, with **139.45 KB already spent**:

| Addition | Estimated gzip |
|---|---:|
| `Workbench.tsx` (grid, outlet, collapse control) | ~0.9 KB |
| `PaneToggle.tsx` + `NoSelection.tsx` | ~0.6 KB |
| `usePaneState.ts` | ~0.2 KB |
| Layout and narrow-window CSS | ~0.4 KB (CSS budget, 5.24 of 20 KB) |
| **Projected initial JS total** | **~141.2 KB** |

Roughly 8.8 KB of headroom left. `size-limit` enforces it in `npm run verify`.

**`ItemDetail` must stay lazy.** It is the boundary that keeps `react-markdown`
and its sanitiser — 49.66 KB gzip — out of the initial bundle. Mounting it as an
outlet child does not change that: the chunk still loads on first selection, which
is why the no-selection pane exists as a separate, tiny component rather than as a
branch inside the detail.

**If the budget fails**: move `Items` behind a lazy boundary too, or trim the
shell. Not raise the number — that is a PATCH amendment needing its own
justification.

---

## 8. Scale

**Decision**: No change. The rail renders the same rows the page renders today.

**Rationale**: SC-005 asks for 200+ items with both panes rendered. The list
already renders 220 rows in the built application — `tests/smoke/scale.spec.ts`
measures it — and moving those rows into a narrower column does not change their
number. The new cost is the detail pane rendered alongside, which is one item.

Worth re-measuring rather than assuming: the scale smoke test should be extended
to select an item, so the figure covers both panes together rather than the list
alone.
