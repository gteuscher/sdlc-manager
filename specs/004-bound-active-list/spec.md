# Feature Specification: Bounding the Active List

**Feature Branch**: `004-bound-active-list`

**Created**: 2026-09-12

**Status**: Draft

**Input**: Two defects found while validating [feature 003](../003-two-pane-workbench/spec.md)
against a built application, recorded in
[003's baseline.md](../003-two-pane-workbench/baseline.md).

## Why this feature exists

The work item list is supposed to be bounded by the lifecycle that owns it. An item
resting in a state its SDLC declares **terminal** leaves the active list, which is
correct, and lifecycle-driven, and already built.

Two things are wrong with it.

**Finished work is unreachable, not merely out of the way.** The list asks for
everything with no filter, so finished items are excluded before they arrive; and
the filter's own options are built from the items that did arrive. A finished state
can therefore never be chosen. An engineer who completes an item cannot look at it
again, cannot confirm it finished in the state they expected, and cannot answer
"what did we finish this week". The escape hatch exists one layer down and no
interface reaches it.

**Nothing requires a lifecycle to declare a terminal state at all.** The manifest
field defaults to absent, and no validation rule checks that any state carries it.
An SDLC package whose author simply forgot to mark the final state produces a list
that grows without bound — silently, with nothing anywhere saying why items never
leave. This is the actual unbounded-growth defect, and because a lifecycle is data
(Principle II), the honest place to catch it is where the data is checked.

The two belong together. Fixing only the second leaves an engineer told their
manifest is wrong, and then unable to see the work that finally starts leaving.
Fixing only the first hands them a view of finished work in a product where nothing
ever finishes.

**What this feature is not.** It adds no way to remove, hide, dismiss or snooze an
item by hand. That was considered and deliberately deferred — see
[Out of scope](#out-of-scope), which explains why it must not be built first.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what finished, and confirm it finished where I expected (Priority: P1)

An engineer finishes a work item and it disappears from the list, which is what
they wanted. Later they need to see it again: to confirm it really did land in the
state they expected rather than stalling somewhere earlier, to re-read the
artifacts behind it, or to answer what a repository has completed recently. Today
the item is simply gone.

**Why this priority**: This is the gap an engineer meets daily, and it is the half
that makes the disappearance trustworthy. A list that hides work with no way to
look at it is asking to be trusted without offering any way to check.

**Independent Test**: Register a repository whose lifecycle declares a terminal
state and which has at least one item resting in it. Confirm the item is absent
from the list by default, that the list says finished work exists, that one
deliberate action brings it into view named and marked as finished, and that
opening it shows everything an active item shows.

**Acceptance Scenarios**:

1. **Given** a repository with both active and finished items, **When** the engineer
   opens the workbench, **Then** only the active items are listed, and the list
   conveys that finished work exists and is not being shown.
2. **Given** that list, **When** the engineer chooses to include finished work,
   **Then** the finished items appear, each marked as finished in a way that does
   not rely on colour, and each showing the state it finished in as its own
   lifecycle names it.
3. **Given** finished work is included, **When** the engineer selects a finished
   item, **Then** the detail pane shows it exactly as it shows an active item —
   its states, gates, artifacts and provenance.
4. **Given** an item is open in the detail pane, **When** the engineer includes or
   excludes finished work, **Then** the detail pane continues to show that item,
   unchanged.
5. **Given** finished work is included, **When** the engineer applies a repository,
   SDLC, state or search filter, **Then** it narrows the finished items the same
   way it narrows active ones.

---

### User Story 2 - Be told when a lifecycle can never let work go (Priority: P2)

An engineer registers a repository and its list grows week after week. Nothing is
broken in any way the dashboard currently reports: the items reconcile, the states
resolve, the gates evaluate. The lifecycle simply declares no state as terminal, so
by its own definition no work is ever finished, and nothing says so.

**Why this priority**: This is the root cause of unbounded growth, and it is
invisible by construction — the symptom is a long list, which looks like being
busy. It is second only because an engineer meets it rarely, and when they do, the
consequence has usually been accumulating for months.

**Independent Test**: Load a lifecycle package that declares no terminal state.
Confirm the application reports it, names the package, and says the consequence,
without the engineer having to read the manifest — and that the repository's items
are still tracked and still shown.

**Acceptance Scenarios**:

1. **Given** a lifecycle package declaring no terminal state, **When** it is loaded,
   **Then** the application reports the condition, naming the package, and states
   the consequence: items following it never leave the active list.
2. **Given** that report, **When** the engineer reads it, **Then** it says what to
   change, in the package rather than in this application.
3. **Given** such a lifecycle, **When** its repository is registered, **Then** its
   items are still discovered, reconciled, listed and openable — the condition is
   reported, not enforced by refusing to track the work.
4. **Given** the package is corrected to declare a terminal state, **When** the
   application next reconciles, **Then** items resting in that state leave the
   active list and the report is gone.

---

### User Story 3 - Return to, and share, a view that includes finished work (Priority: P3)

An engineer arranges a view — one repository, finished work included, a search
term — and wants to come back to it after a restart, or send it to a colleague
reviewing the same release.

**Why this priority**: It is the consistency requirement rather than a new
capability. Feature 003 established that the URL holds what another person or
another session should be able to arrive at, and a new piece of view state that
did not follow that rule would be the exception that starts eroding it.

**Independent Test**: Include finished work, apply a filter and a search, copy the
address, and open it fresh. All three come back together.

**Acceptance Scenarios**:

1. **Given** a view with finished work included and filters applied, **When** the
   engineer returns to the same address, **Then** the inclusion, the filters and
   the search are all restored.
2. **Given** an address that does not mention finished work, **When** it is opened,
   **Then** finished work is excluded — the safe, quieter default.

---

### Edge Cases

- **Every item in a repository is finished.** The active list is empty, and the
  empty state must distinguish "nothing is in flight" from "nothing is here" — and
  point at the finished work rather than leaving the engineer to conclude their
  repository is broken.
- **A lifecycle whose every state is terminal.** Nothing is ever active. This is
  the mirror of Story 2's defect and is just as reportable: a lifecycle that
  finishes work the instant it appears is describing something other than a
  lifecycle.
- **An item whose recorded state has no counterpart in the loaded definition.** It
  is unmapped, so whether it is finished is unknowable. It must never be treated as
  finished, and must stay in the active list where it can be seen and fixed.
- **A repository whose definition could not be loaded at all.** Terminal-ness is
  unknowable for every item in it. Nothing may be assumed in either direction, and
  the items stay visible.
- **An item that leaves a terminal state again.** Work is reopened, or a provider
  corrects itself. The item must return to the active list on the next
  reconciliation without anyone intervening — which is a property of deriving
  finishedness rather than recording it.
- **The finished list is itself unbounded.** Finished work only accumulates. The
  view that includes it must stay usable as it grows, and must not become the
  same problem this feature exists to solve, wearing an opt-in label.
- **An item finished before the application ever saw it.** No transition into the
  terminal state was ever observed, so nothing is known about *when* it finished —
  only that it is there now. Anything the feature says about finished work must be
  true of this item too.

## Requirements *(mandatory)*

### Reaching finished work

- **FR-001**: The item list MUST offer an explicit, discoverable way to include work
  its lifecycle considers finished, and MUST exclude it by default.
- **FR-002**: The list MUST convey that finished work exists and is not currently
  shown, rather than leaving its absence to be noticed.
- **FR-003**: When included, a finished item MUST be distinguishable from active
  work **without relying on colour**, and MUST show the state it finished in as
  that state's own lifecycle names it.
- **FR-004**: Selecting a finished item MUST open it in the detail pane with
  everything an active item shows — its states, gates, artifacts and provenance.
- **FR-005**: Including or excluding finished work MUST NOT change what the detail
  pane is showing.
- **FR-006**: Every existing filter and the search MUST narrow finished work the
  same way they narrow active work.
- **FR-007**: Whether finished work is included MUST be restored by returning to
  the same address, and MUST travel in a shared link.
- **FR-008**: An item MUST be treated as finished **only** when the repository's own
  loaded definition declares the state it rests in as terminal. The application MUST
  NOT infer it, guess it, or store it.
- **FR-009**: The view that includes finished work MUST remain usable as finished
  work accumulates.

### Reporting a lifecycle that never releases work

- **FR-010**: The application MUST report a loaded lifecycle that declares no
  terminal state, naming the package.
- **FR-011**: The report MUST state the consequence — that items following this
  lifecycle never leave the active list — and MUST say that the correction belongs
  in the package, not in this application.
- **FR-012**: A lifecycle declaring no terminal state MUST still load, and its
  repository's items MUST still be discovered, reconciled, listed and openable. The
  condition is reported, never enforced by refusing to track the work.
- **FR-013**: The report MUST clear itself once the package declares a terminal
  state, without any action in this application beyond the next reconciliation.
- **FR-014**: The application MUST report a lifecycle whose every state is terminal
  on the same terms as FR-010 and FR-011.

### Preservation

- **FR-015**: An unmapped item MUST NOT be treated as finished and MUST remain in
  the active list.
- **FR-016**: When a repository's definition could not be loaded, its items MUST
  remain visible and MUST NOT be treated as finished or as active by assumption.
- **FR-017**: An item that leaves a terminal state MUST return to the active list on
  the next reconciliation.
- **FR-018**: Every behaviour features 001 and 003 deliver MUST survive unchanged —
  attention-first ordering, the two distinct attention markers, the attention count,
  unmapped items showing their raw recorded value, provider disagreement, staleness
  with retry, the state tabs, the gate statuses, artifact provenance, the console,
  and both panes of the workbench.
- **FR-019**: The application MUST NOT close, transition, reopen or write anything to
  any system of record. Finishing work happens where the work happens.
- **FR-020**: No state, gate, transition or provider name may appear in the
  interface or be hardcoded in application logic.

### Out of scope

- **FR-021**: This feature MUST NOT add any manual way to remove, hide, dismiss or
  snooze a work item.

This is a deferral, recorded so a later reader does not mistake the silence for an
oversight. A manual hide is only worth building for the residue this feature does
not cover: unmapped items, which are deliberately never treated as finished, and
work stalled in a non-terminal state that nobody will ever close in its system of
record.

It must not be built before this feature. A hide control layered over an
unvalidated manifest would conceal the defect in Story 2 rather than fix it, and
would make an ever-growing list look like an engineer's tidying problem instead of
a packaging bug.

When it is built, it must never be a permanent hide. The dashboard's central
promise is that it tells you what is waiting on you; a control that can silently
suppress an item that later needs your input breaks the one thing the product
guarantees.

## Key Entities

- **Finished item**: a work item resting in a state its repository's loaded
  definition declares terminal. Derived on every read, never recorded. Nothing about
  an item changes when it becomes finished except which state it rests in.
- **Lifecycle release condition**: whether a loaded lifecycle declares any terminal
  state at all. A property of the definition, not of any item, and reportable
  against the package rather than against a repository.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An engineer can confirm that a named item finished, and in which
  state, without leaving the workbench and without editing an address by hand.
- **SC-002**: An engineer who has not seen this feature before can discover that
  finished work exists and bring it into view within 30 seconds.
- **SC-003**: With finished work excluded, every item listed is one its own
  lifecycle considers in flight — demonstrated across at least two different
  lifecycles with different state vocabularies.
- **SC-004**: A lifecycle declaring no terminal state is reported within one
  reconciliation of being loaded, naming the package, without the engineer opening
  the manifest.
- **SC-005**: An item reopened in its system of record returns to the active list
  within one reconciliation, with no action taken in this application.
- **SC-006**: **Every acceptance scenario from features 001 and 003 still passes.**
  This feature withdraws nothing.
- **SC-007**: With at least 200 items across at least 3 repositories and finished
  work included, identifying what needs the engineer still takes under ten seconds.
- **SC-008**: Including or excluding finished work never changes which item the
  detail pane is showing.

## Assumptions

- **This product reports rather than refuses, and Story 2 follows that precedent.**
  001's FR-045 reports a package carrying no manifest as unsupported instead of
  failing; an unmapped state is reported and the item stays tracked. A lifecycle
  with no terminal state is unusual rather than malformed — a continuous process is
  a legitimate thing to describe — so it is reported and its work is still tracked,
  not rejected. If it were treated as a hard validation failure instead, every
  existing package would have to be audited before this feature could ship.
- **Finished work is not time-bounded in this feature.** "Finished in the last 30
  days" was considered and rejected: *when* an item finished is only known for
  transitions this application actually observed, so an item that was already
  finished when the repository was first registered would be silently missing from
  a time-bounded list. Quiet incompleteness is the failure this product refuses.
  The existing repository, SDLC, state and search filters narrow the finished view
  instead. A deliberate, honest time bound is a later judgement.
- **Terminal-ness is already expressible.** The manifest field exists and the
  engine already reads it; nothing new is added to the lifecycle format, and no
  package has to change to benefit — except the ones Story 2 exists to name.
- **No new provider, and no new system of record.** Nothing about finishedness is
  written anywhere. The application remains read-only.
- **The reference to "the list" means the workbench's list pane** as feature 003
  built it. This feature adds to that pane; it does not add a fourth view.

## Dependencies

- **Feature 003 (Two-Pane Workbench)** — this feature adds a control to the list
  pane 003 created, and inherits its rule that the address holds what another
  person or another session should be able to arrive at.
- **Feature 001 (SDLC Work Item Dashboard)** — the filter model, the item list, the
  repositories view where package-level conditions are surfaced, and the terminal
  handling this feature makes reachable.
- **Feature 002 (Work Item Hierarchy)** is independent of this one. If it lands
  first, finished work must nest the same way active work does.
