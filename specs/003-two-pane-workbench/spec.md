# Feature Specification: Two-Pane Workbench

**Feature Branch**: `003-two-pane-workbench`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Re-shape the dashboard into the two-pane workbench the original description asked for: a persistent left pane listing every active work item with its attention markers, and a right pane that loads the selected item's SDLC state tabs, both visible at once rather than as separate pages. The left pane is collapsible. The repositories view stays a separate view. This corrects a miss in feature 001, whose Input described left and right panes but whose functional requirements never encoded the layout, so the implementation shipped a single list page with filters on top and a separate detail page. Reference: c:\dev\game-style-harness uses a 224px left rail collapsible to 52px beside a flexible main pane at full viewport height."

## Why this feature exists

This is a **correction**, and recording why is more useful than pretending it is new scope.

Feature 001's Input said, in the maintainer's own words: *"on the left pane, you
have all of your active items with notifications when they need your input.
clicking on an item should load the right pane with tabs of all of the states of
the SDLC at the top."*

That sentence never became a requirement. Feature 001 has forty-eight functional
requirements covering aggregation, attention, state navigation, artifacts,
configuration and sourcing, and **not one of them mentions layout**. The words
"left pane" and "right pane" appear exactly once in the whole document, in the
quoted Input.

So the implementation satisfied every requirement while not building the
described product: a single list page with filters across the top, and a separate
page for item detail. Each page is individually correct. Together they are not a
workbench — the engineer cannot see what needs them and what they are working on
at the same time, which is the entire point of the shape that was asked for.

The lesson is narrow and worth keeping: **"no implementation details in the spec"
is a good rule that quietly deleted the product's primary interaction.** Layout is
usually an implementation detail. When the layout *is* the user experience — when
two things must be visible at once for the tool to do its job — it is a
requirement, and it has to be written as one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what needs me and what I am working on, at once (Priority: P1)

The engineer opens the dashboard and sees every active work item in a persistent
pane down the left side, each with its attention marker. Selecting one loads that
item's detail into the right pane. The list stays put: the engineer can read the
selected item's state while still seeing what else is waiting, and can move to the
next item without navigating back to a list first.

**Why this priority**: This is the whole feature. Everything else here refines it.
A dashboard whose two halves cannot be seen together is a report, not a workbench —
the distinction the reference projects are admired for.

**Independent Test**: Register a repository with several items including at least
one needing attention, select an item, and confirm the detail appears beside the
list rather than replacing it, with the list still showing every other item and
its markers.

**Acceptance Scenarios**:

1. **Given** several active items, **When** the dashboard opens, **Then** the item
   list occupies a persistent left pane and remains visible thereafter.
2. **Given** the item list, **When** the engineer selects an item, **Then** its
   detail loads in the right pane **and the list remains visible and unchanged**.
3. **Given** a selected item, **When** the engineer selects a different one,
   **Then** the right pane changes without the list scrolling to the top or
   losing its position.
4. **Given** a selected item, **When** the list renders, **Then** the selected item
   is visibly marked as selected in the list.
5. **Given** an item needing attention elsewhere in the list, **When** the engineer
   is reading a different item, **Then** that marker is still visible without
   leaving the current item.
6. **Given** no item is selected, **When** the dashboard opens, **Then** the right
   pane shows deliberate copy explaining what selecting an item will do — not an
   empty frame.

---

### User Story 2 - Give the work room when I need it (Priority: P2)

The engineer collapses the left pane to give the artifact they are reading the
full width, and expands it again when they want to see what else is waiting. The
collapsed pane still shows enough to be useful — that something needs attention —
rather than disappearing entirely.

**Why this priority**: Long specifications and large test runs are the common case
in the right pane, and a fixed rail that cannot yield makes them unpleasant to
read. Separable: the workbench is useful before it collapses.

**Independent Test**: Collapse the pane, confirm the right pane takes the width and
the attention state is still discoverable; expand it and confirm the list returns
with its scroll position and selection intact.

**Acceptance Scenarios**:

1. **Given** the expanded pane, **When** the engineer collapses it, **Then** the
   right pane occupies the freed width.
2. **Given** the collapsed pane, **When** any item needs attention, **Then** that
   fact remains visible without expanding.
3. **Given** the collapsed pane, **When** the engineer expands it, **Then** the
   list returns with its previous scroll position and the same item selected.
4. **Given** any collapse state, **When** the engineer returns to the view later,
   **Then** the state they left it in is restored.
5. **Given** the collapsed pane, **When** the engineer navigates by keyboard only,
   **Then** the control to expand it is reachable and operable.

---

### User Story 3 - Filter and search without losing the workbench (Priority: P2)

Filtering by repository, SDLC or state, and searching by identifier or title, all
happen within the left pane and narrow the list in place. The right pane is
unaffected: an item being read stays readable even when the filter no longer
matches it.

**Why this priority**: Feature 001 put filters across the top of a full-width page.
In a rail they have to be re-thought rather than moved, and getting this wrong
makes the pane unusable at its narrow width. It is separable because the workbench
works before the filters are refined.

**Independent Test**: With an item selected, apply a filter that excludes it, and
confirm the right pane still shows that item while the list narrows.

**Acceptance Scenarios**:

1. **Given** the left pane, **When** the engineer filters or searches, **Then** the
   list narrows in place and the right pane does not change.
2. **Given** a selected item excluded by a new filter, **When** the list narrows,
   **Then** the right pane continues to show it, and the list conveys that the
   selection is not currently listed.
3. **Given** active filters, **When** the pane is narrow, **Then** the controls
   remain usable and legible rather than overflowing.
4. **Given** any filter or search state, **When** the engineer returns to the view
   directly, **Then** the same state is restored.

---

### Edge Cases

- **No repositories registered.** The left pane has nothing to list and the right
  pane has nothing to show; both need deliberate copy, and the path to registering
  a repository must be obvious from here.
- **A very long item title**, or many items, in a pane of fixed width.
- **A very large artifact** in the right pane while the list is expanded.
- **The window is narrow** — small laptop, or the window dragged small — and two
  panes side by side stop being workable.
- **The selected item disappears** because it reached a terminal state, its
  repository was removed, or a reconciliation dropped it.
- **A deep link to an item** arrives when the list has not loaded yet.
- **The item list fails to load** while an item is selected, or the reverse.
- **Every item is filtered out** while one is selected.
- **Keyboard-only navigation** between the two panes, and out of a collapsed one.

## Requirements *(mandatory)*

### Layout

- **FR-001**: System MUST present the active work item list and the selected item's
  detail **simultaneously**, as two panes of one view, rather than as separate
  pages reached by navigation.
- **FR-002**: The item list MUST occupy a persistent pane on the leading side of
  the view and remain visible while an item is being read.
- **FR-003**: The detail pane MUST fill the remaining width, and the view MUST use
  the full height of the window.
- **FR-004**: Selecting an item in the list MUST load that item into the detail
  pane **without** replacing, reloading, or repositioning the list.
- **FR-005**: The list MUST indicate which item is currently selected.
- **FR-006**: With no item selected, the detail pane MUST present deliberate copy
  describing what selection does — never an empty frame.
- **FR-007**: The selected item MUST remain reflected in application navigation, so
  a particular item and state can still be returned to directly.

### Collapsing

- **FR-008**: The engineer MUST be able to collapse and expand the list pane.
- **FR-009**: A collapsed pane MUST still convey that items need attention, and how
  many, without being expanded.
- **FR-010**: Expanding MUST restore the list with its prior scroll position and
  selection.
- **FR-011**: The collapse state MUST persist across navigation and restarts.
- **FR-012**: Every collapse and expand control MUST be reachable and operable by
  keyboard, and MUST carry a correct role and accessible name.

### Narrowing

- **FR-013**: Filtering by repository, SDLC and state, and searching by identifier
  or title, MUST remain available within the list pane and MUST narrow the list in
  place.
- **FR-014**: Narrowing the list MUST NOT change what the detail pane shows.
- **FR-015**: When the selected item is excluded by the current filter, the system
  MUST continue to show it in the detail pane and MUST convey that it is not
  present in the list as filtered.
- **FR-016**: Filter, search and selection state MUST all be restorable by
  returning to the view directly.

### Degrading

- **FR-017**: When the window is too narrow for two usable panes, the system MUST
  present one pane at a time with a way to move between them, rather than rendering
  either pane unusable.
- **FR-018**: When the selected item is no longer available, the detail pane MUST
  say so and offer a way back to the list, rather than blanking.
- **FR-019**: Each pane MUST report its own failure in place, with a retry, and a
  failure in one MUST NOT blank the other.
- **FR-020**: A deep link to an item that has not loaded yet MUST show a bounded
  pending state in the detail pane while the list loads.

### Preservation

- **FR-021**: Every behaviour feature 001 delivers MUST survive this re-shaping —
  attention-first ordering, the two distinct attention markers, unmapped items
  showing their raw value, provider disagreement, stale marking with retry, the
  attention count, lifecycle-driven state tabs, gate results distinguishing the
  three statuses, artifact rendering and provenance, and the advisory console.
- **FR-022**: The repositories view MUST remain a separate view, reachable as it is
  today.
- **FR-023**: The interface MUST NOT gain knowledge of any state, gate, transition
  or provider name as a consequence of this change.

## Key Entities

- **Pane Layout State**: Which item is selected, whether the list pane is
  collapsed, and the list's filter and search state. A view preference throughout —
  it describes how the engineer has arranged their workbench, never anything about
  the work itself, and it is never a system of record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: While reading any item, an engineer can identify every other item
  needing their attention **without navigating away from the item they are
  reading**, in 100% of cases.
- **SC-002**: Moving from one item to the next takes **one** interaction — no step
  that returns to a list first.
- **SC-003**: From opening the application, an engineer can identify every item
  awaiting their input within 10 seconds, whether the list pane is expanded or
  collapsed (preserving SC-001 of feature 001).
- **SC-004**: Every acceptance scenario in feature 001's user stories 1 through 5
  still passes after the re-shaping, with no requirement withdrawn.
- **SC-005**: An engineer supervising at least 200 active items can still complete
  SC-003 within its stated time, with both panes rendered.
- **SC-006**: The workbench is fully operable by keyboard alone: reaching the list,
  selecting an item, moving into the detail pane, and collapsing or expanding the
  list.
- **SC-007**: At a window width where two panes stop being usable, no pane is ever
  rendered unusably narrow; one is presented at a time instead.

## Assumptions

- **This replaces the list and detail routes; it does not add a third view.** The
  two panes are one view. The repositories view is untouched.
- **The reference layout is a starting point, not a requirement.** The 224px rail
  collapsing to 52px in `game-style-harness` describes the shape that was asked
  for; exact measurements are a design decision, and only the behaviour above is
  specified.
- **Layout state is a view preference, not domain state**, and belongs wherever the
  application already keeps such state — not in any store of record.
- **No new data is required.** Everything both panes display is already available;
  this feature re-arranges what feature 001 delivers and adds no provider,
  no manifest field, and no bridge capability.
- **Feature 002 (work item hierarchy) is sequenced after this one.** Its subject is
  nesting inside "the left nav", which this feature creates. Nesting a list that is
  not yet a nav would mean building it twice.
- **The pinned workflow strip seen in the reference project is out of scope**,
  deliberately. The state tabs feature 001 already delivers serve the same purpose,
  and adding a second progress indicator alongside them is a separate judgement.

## Dependencies

- Feature `001-sdlc-work-item-dashboard`, whose item list, item detail, attention
  derivation, filters, and console this feature re-arranges. All of it must keep
  working (FR-021, SC-004).
- No new dependency on any provider, manifest capability, or bridge method.
