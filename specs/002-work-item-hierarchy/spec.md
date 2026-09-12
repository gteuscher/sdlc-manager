# Feature Specification: Work Item Hierarchy

**Feature Branch**: `002-work-item-hierarchy`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "when the provider is jira, the left nav may need to have some nesting. a developer could be assigned to an epic, and that epic can have 0 to many stories under it, so they would see the Epic which could be treed to show the stories under it. if any sub story needs user action we should also show the notification status on the epic as well"

## Framing note: declared, not provider-specific

The request names Jira, and Jira epics are the motivating case. The specification
below is nonetheless written in terms of a **lifecycle-declared** parent/child
relationship rather than a provider-specific one, for a reason that is
constitutional rather than stylistic:

- Principle II requires that no provider name or lifecycle structure be hardcoded
  in application logic, and that adding a state, gate, or relationship be a
  configuration change.
- Principle VI requires that adding a new provider need no change to the workflow
  engine or the UI.

A rule reading "if the provider is Jira, nest the list" would violate both, and
would have to be written again for GitHub sub-issues, for a filesystem lifecycle
nesting directories, and for every tracker added later. So the manifest declares
that its items form a hierarchy and names the field the relationship is read from;
the interface nests whatever it is given. Jira is then the first lifecycle to use
it, not a special case in the code.

This is the same move the existing dashboard makes for states and gates, and it is
what makes the feature testable against a lifecycle nobody has written yet.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the work under an epic without losing the epic (Priority: P1)

An engineer assigned an epic opens the dashboard and sees the epic as a single row
rather than as a scattering of unrelated stories. The row can be expanded to reveal
the stories beneath it, each with its own state, and collapsed again to get back to
a short list. An epic with no stories under it looks like any other row — there is
nothing to expand and no empty affordance suggesting otherwise.

**Why this priority**: Without it, an engineer working at epic granularity sees
either the epic alone (and cannot tell what is inside it) or every story flattened
(and cannot tell what belongs together). The nesting is the feature; everything
else here refines it.

**Independent Test**: Register a repository whose lifecycle declares a parent/child
relationship, seed one epic with three stories and one epic with none, and confirm
the first renders as an expandable group containing exactly those three stories and
the second renders as an ordinary row.

**Acceptance Scenarios**:

1. **Given** an epic with three stories, **When** the list renders, **Then** the
   epic appears as one row that can be expanded to show exactly those three
   stories.
2. **Given** an epic with no stories, **When** the list renders, **Then** it
   appears as an ordinary row with no expansion affordance.
3. **Given** an expanded epic, **When** the engineer collapses it, **Then** its
   stories are hidden and the epic remains visible.
4. **Given** a lifecycle that declares no hierarchy, **When** its items render,
   **Then** the list is flat and unchanged from today.
5. **Given** two registered repositories, one with a hierarchical lifecycle and one
   without, **When** the list renders, **Then** both appear in the one list, each
   presented according to its own lifecycle.

---

### User Story 2 - Know that something inside an epic needs me (Priority: P1)

When any story beneath an epic is waiting on the engineer, the epic itself carries
an attention marker, so a collapsed list still tells them where their attention is
owed. Crucially, the marker distinguishes *the epic needs you* from *something
inside this epic needs you* — an engineer who cannot tell those apart has to expand
every epic to find out, which is the problem the roll-up was meant to solve.

**Why this priority**: This is the half of the request that carries the risk. A
roll-up that is indistinguishable from a direct signal makes the list less
informative than it is today, not more, because every marker becomes ambiguous.

**Independent Test**: Seed an epic that needs no action containing one story
awaiting input, and a second epic that itself awaits input containing only
progressing stories; confirm both epics are marked, that the two markers are
visibly different, and that the engineer can tell which is which without expanding
either.

**Acceptance Scenarios**:

1. **Given** a collapsed epic containing a story awaiting human input, **When** the
   list renders, **Then** the epic carries a marker indicating that a descendant
   needs action.
2. **Given** an epic that itself awaits human input, **When** the list renders,
   **Then** it carries a marker indicating that the epic itself needs action,
   visibly distinct from the descendant marker.
3. **Given** an epic that both awaits input itself and contains a story with a
   failed gate, **When** the list renders, **Then** both facts are conveyed rather
   than one masking the other.
4. **Given** a descendant marker on a collapsed epic, **When** the engineer expands
   it, **Then** the specific story carrying the signal is identifiable.
5. **Given** an epic whose descendant signal clears, **When** the list next
   reconciles, **Then** the epic's rolled-up marker clears without a restart.
6. **Given** an epic and a story beneath it that both need action, **When** the
   attention count renders, **Then** each item is counted once and the count does
   not double-count the roll-up.

---

### User Story 3 - Work the tree without losing your place (Priority: P2)

Expansion state, filters, and search continue to behave sensibly once rows nest.
Filtering to a state that only some stories occupy still shows those stories, with
enough surrounding context to know which epic they belong to. A view the engineer
has arranged can be returned to directly.

**Why this priority**: Stories 1 and 2 deliver the value; this is what stops the
list becoming annoying at the second use. It is separable — the tree is useful
before it remembers anything.

**Independent Test**: Expand two of five epics, apply a state filter matching only
nested stories, and confirm the matching stories are visible with their parents
shown as context; reload the view and confirm the arrangement is restored.

**Acceptance Scenarios**:

1. **Given** an expanded epic, **When** the engineer navigates to an item and back,
   **Then** the expansion state is preserved.
2. **Given** a search matching only a nested story, **When** results render,
   **Then** the story is shown together with the epic it belongs to.
3. **Given** a filter matching an epic but none of its stories, **When** results
   render, **Then** the epic is shown and its childless state is not misrepresented
   as having no children.
4. **Given** any arrangement of expansion and filters, **When** the engineer
   returns to the view directly, **Then** the same arrangement is presented.

---

### Edge Cases

- **An epic is assigned to the engineer but its stories are not.** Ownership is
  scoped per item (FR-001a of the existing dashboard), so the stories are not the
  engineer's work. They are shown as context, marked as not theirs (FR-021).
- **A story is assigned to the engineer but its epic is not.** The engineer owns
  the story and not the parent, yet the parent is needed to place it.
- **The parent is not visible for another reason** — it is terminal, it is filtered
  out, or it lives in a repository that is not registered.
- **A relationship points at an item that does not exist**, has been deleted, or
  sits outside the registered repositories.
- **A relationship is circular** — an item that is its own ancestor, directly or
  through a chain. This must be detected rather than followed.
- **The hierarchy is deeper than two levels** — an epic containing stories
  containing sub-tasks.
- **A child appears under two parents.**
- **All of an epic's stories reach a terminal state** while the epic itself has
  not.
- **A child's recorded state is unmapped**, or its lifecycle no longer declares it.
- **An epic contains hundreds of stories**, and expanding it must not make the list
  unusable.
- **The relationship field is declared but the provider returns nothing for it**,
  so every item appears to be a root.
- **Two lifecycles disagree about hierarchy** — one declares it, one does not, and
  both appear in the same list.

## Requirements *(mandatory)*

### Hierarchy declaration

- **FR-001**: System MUST read parent/child relationships between work items from
  the lifecycle's declarative manifest, and MUST NOT infer a hierarchy from which
  provider supplies an item.
- **FR-002**: System MUST continue to present a flat list for any lifecycle that
  declares no hierarchy, with no change to its current behaviour.
- **FR-003**: System MUST validate a hierarchy declaration before use, rejecting an
  invalid one with a message naming the offending field and the reason, consistent
  with how every other part of a manifest is validated.
- **FR-004**: System MUST present the relationship to whatever depth the data
  contains, rather than assuming exactly two levels.
- **FR-005**: System MUST record, for each item, which item it names as its parent,
  so that the relationship is inspectable rather than implicit in the display.

### Presentation

- **FR-006**: System MUST present a parent item as a single row that can be
  expanded to reveal its children and collapsed to hide them.
- **FR-007**: System MUST present an item with no children as an ordinary row,
  offering no expansion affordance.
- **FR-008**: System MUST show, on a collapsed parent, how many children it has.
- **FR-009**: System MUST reflect expansion state in application navigation so that
  a particular arrangement can be returned to directly.
- **FR-010**: System MUST keep every child visually associated with its parent at
  any supported depth.

### Attention roll-up

- **FR-011**: System MUST mark a parent when any descendant carries an attention
  signal, at any depth.
- **FR-012**: System MUST distinguish a parent's **own** attention signal from a
  signal **rolled up from a descendant**, so that the two are not confusable
  without expanding the parent.
- **FR-013**: System MUST convey both facts when a parent has its own signal *and*
  a descendant signal, rather than allowing one to mask the other.
- **FR-014**: System MUST make the descendant signal actionable — on expansion, the
  descendants carrying it MUST be identifiable without inspecting each one.
- **FR-015**: System MUST count each item needing attention exactly once in the
  attention count; a rolled-up marker MUST NOT add to the count.
- **FR-016**: System MUST order the list so that parents whose own or rolled-up
  attention is set appear before those progressing normally, keeping each child
  with its parent.
- **FR-017**: System MUST update a rolled-up marker as the underlying items change,
  without requiring a restart.
- **FR-018**: System MUST derive the rolled-up marker from the descendants' own
  signals, so that it is reproducible after a restart and a cache wipe.

### Ownership and placement

- **FR-019**: System MUST continue to scope the list to the engineer's own work; a
  hierarchy MUST NOT cause items the engineer neither owns nor holds artifacts for
  to be counted as theirs.
- **FR-020**: System MUST present a child the engineer owns whose parent they do not
  own beneath that parent, with the parent shown as **context**: visibly marked as
  not the engineer's work, never counted toward the attention count, and carrying
  no attention marker of its own. The child keeps its place in the hierarchy
  without the list claiming the parent as theirs.
- **FR-021**: System MUST present children the engineer does not own beneath a
  parent they do own, **visibly marked as not the engineer's work**. An engineer
  assigned a parent generally needs to see what it contains, so hiding such
  children would defeat the purpose of nesting; marking them is what keeps the
  list's ownership guarantee honest.
- **FR-021a**: An item shown only as context — whether an unowned parent (FR-020)
  or an unowned child (FR-021) — MUST NOT contribute to the attention count, MUST
  NOT be counted as the engineer's work by any success criterion, and MUST be
  distinguishable from owned items **without** relying on colour alone.
- **FR-021b**: A context item's own attention state MUST NOT roll up to an owned
  ancestor as though the engineer were being asked to act. Where it is surfaced at
  all, it MUST be distinguishable from a roll-up of the engineer's own work.

### Degenerate and hostile data

- **FR-022**: System MUST detect a circular relationship and report it, rather than
  following it, and MUST continue to render the rest of the list.
- **FR-023**: System MUST present an item whose declared parent cannot be found as
  a root item, reporting that its parent is unresolved rather than hiding it.
- **FR-024**: System MUST handle an item naming more than one parent deterministically,
  reporting the ambiguity rather than duplicating the item in the list.
- **FR-025**: System MUST continue to apply the existing rules for terminal and
  unmapped items to children, and MUST present a parent whose children have all
  reached a terminal state without implying it has none.
- **FR-026**: System MUST remain usable when a parent has a very large number of
  children, without blocking the rest of the view.

### Filtering and search

- **FR-027**: System MUST show a matching child together with enough of its
  ancestry to identify where it belongs, when a filter or search matches the child
  but not its parent.
- **FR-028**: System MUST NOT present a parent that is excluded by a filter as
  though it had no children.

## Key Entities

- **Work Item Relationship**: The declared link from one work item to its parent,
  read from the system of record through the field the lifecycle names. Zero or one
  parent per item; a parent may have zero to many children.
- **Item Group**: A parent together with its descendants, as the list presents it.
  A presentation concern — it is derived from the relationships and is never a
  system of record.
- **Rolled-up Attention Signal**: A derived indication that some descendant of an
  item needs human action, distinct in kind from the item's own attention signal
  and never counted as a separate item needing attention.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With every parent collapsed, an engineer can identify every group
  containing work that needs them within 10 seconds, without expanding anything.
- **SC-002**: An engineer can tell whether a marked parent needs their action
  itself or contains something that does, without expanding it, in 100% of cases.
- **SC-003**: A lifecycle declaring a hierarchy the application has never seen is
  adopted with configuration changes only and no change to the application itself.
- **SC-004**: The attention count equals the number of distinct **owned** items
  needing action; neither a roll-up nor a context item ever causes an item to be
  counted twice or counted at all when it is not the engineer's work.
- **SC-004a**: An engineer can distinguish an owned item from a context item at a
  glance, in greyscale, in 100% of cases.
- **SC-005**: Lifecycles declaring no hierarchy render identically to how they
  render before this feature, with no regression in the existing acceptance
  scenarios.
- **SC-006**: An engineer supervising at least 200 active items, at least 50 of
  them nested beneath parents, can still complete SC-001 within its stated time.
- **SC-007**: Expanding a parent with 200 children leaves the rest of the list
  usable.
- **SC-008**: Every nesting relationship the interface displays traces to the
  loaded lifecycle definition and the system of record; none is inferred from which
  provider supplied an item.

## Assumptions

- **The list is the engineer's own work, plus the context needed to place it.**
  Resolved during specification: unowned parents and unowned children are both
  shown, marked, and excluded from every count. The alternative — a list containing
  only owned items — was rejected because an epic assigned to an engineer whose
  stories all belong to teammates would render as an empty group, which is more
  misleading than showing the stories and saying whose they are.
- **Hierarchy is a property of the work, not of the provider.** Jira epics are the
  first case, but the feature is specified and will be tested against a lifecycle
  that has nothing to do with Jira, for the constitutional reasons in the framing
  note above.
- **An item has at most one parent.** Multi-parent structures exist in some
  trackers and are treated as a degenerate case to be reported (FR-024), not as a
  supported shape.
- **The relationship is read, never written.** This feature inherits v1.0's
  read-only posture: it observes the hierarchy the system of record already holds,
  and does not let the engineer re-parent anything.
- **Depth is data-driven and expected to be shallow.** Two levels is the common
  case; the interface does not impose a limit, and no scenario assumes one.
- **Roll-up is derived at read time** from descendants' signals, not stored, so it
  survives a restart and a cache wipe like every other attention marker.
- **Expansion state is a view preference**, not domain state, and belongs in
  application navigation rather than in any store.
- **Existing single-level behaviour is the baseline.** Any change to how a flat
  list renders is a regression, not a consequence of this feature.

## Dependencies

- The SDLC Work Item Dashboard (feature `001-sdlc-work-item-dashboard`), whose item
  list, attention derivation, and manifest contract this feature extends. This
  feature cannot be delivered before the item list and attention signals exist.
- A lifecycle manifest contract able to express a parent/child relationship. The
  current contract has no such field, so adopting this feature requires a contract
  version change, with the version-refusal behaviour that already exists applying
  to manifests written against the newer contract.
- For the motivating case: an issue tracker that records a parent relationship
  between items, and credentials for it.
