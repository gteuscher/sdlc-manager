# Feature Specification: SDLC Work Item Dashboard

**Feature Branch**: `001-sdlc-work-item-dashboard`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "as mentioned I want an app that ideally works with an SDLC harness so that users can easily track the state of all of their work items. c:\dev\game-style-harness has a dashboard similar to what I'm thinking. on the left pane, you have all of your active items with notifications when they need your input. clicking on an item should load the right pane with tabs of all of the states of the SDLC at the top, opened to the state the ticket is in, with clear markers with what's been completed so far. for v1.0, we can have simplified artifacts pertaining to those statuses, which could be markdown files, or content pulled in from jira, or the results of automated tests. the example project (also check out c:\dev\buildersgate which is another inspiration) has a built in conversation console that scopes each tab to its specific phase's information and/or agents. additionally there should be another view that allows you to view all of the repositories using a given SDLC so you can configure any necessary configuration for that repo (the example SDLC at work has yaml files with defined gates, for example)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every active work item and what needs me (Priority: P1)

An engineer running several pieces of work through an agentic SDLC opens the dashboard and sees,
in one list, every work item currently in flight across all of the repositories they have
registered. Each row shows the item's title, which SDLC it is following, and which state it
currently sits in. Items that cannot progress without a human decision — an approval, a failed
gate, an answer an agent is waiting on — are visibly marked so the engineer can tell at a glance
where their attention is owed, without opening anything.

**Why this priority**: This is the product's core claim. An engineer supervising several
concurrent agentic workflows loses track of which ones are blocked on them; a single list that
surfaces that is valuable even if nothing else in this spec is built.

**Independent Test**: Register two repositories using different SDLC definitions, seed work items
in various states including at least one awaiting human input, open the dashboard, and confirm
the list shows every active item with the correct state and that only the blocked item carries an
attention marker.

**Acceptance Scenarios**:

1. **Given** two registered repositories using different SDLC definitions, **When** the engineer
   opens the dashboard, **Then** the item list shows active items from both repositories together,
   each labelled with its SDLC and current state.
2. **Given** a work item whose current state is declared as awaiting human input, **When** the
   list renders, **Then** that item carries an attention marker and is ordered ahead of items that
   are progressing normally.
3. **Given** a work item whose gate evaluation failed, **When** the list renders, **Then** that
   item carries an attention marker distinguishable from "awaiting input".
4. **Given** the underlying system of record changes an item's state, **When** the dashboard next
   reconciles, **Then** the row updates without the engineer restarting the application.
5. **Given** no repositories have been registered yet, **When** the engineer opens the dashboard,
   **Then** an explanatory empty state offers the action to register a repository.

---

### User Story 2 - Follow one item through its SDLC states (Priority: P2)

The engineer clicks a work item. A detail view opens showing the states of that item's SDLC laid
out in order as tabs, opened to the state the item currently occupies. Each tab carries a marker
showing whether that state is completed, in progress, blocked, or not yet reached, so the
engineer can see at a glance how far the item has travelled and where it stalled. Selecting any
tab shows the artifacts belonging to that state and the results of that state's gates.

**Why this priority**: The list answers "what needs me"; this answers "what happened and what is
left". It is the second half of tracking, but the list is independently useful without it.

**Independent Test**: Open an item that has completed three of six states, and confirm the detail
view opens on the fourth, marks the first three complete, shows the remaining two as not reached,
and renders the gate results recorded for each completed state.

**Acceptance Scenarios**:

1. **Given** an item in the fourth of six SDLC states, **When** the engineer opens it, **Then**
   the detail view presents six tabs in SDLC order and opens on the fourth.
2. **Given** a state whose gates all passed, **When** its tab renders, **Then** it is marked
   completed and each gate shows its passing result.
3. **Given** a state with a gate that has never been evaluated, **When** its tab renders, **Then**
   that gate shows as not evaluated rather than as passed or failed.
4. **Given** a state the item has not reached, **When** its tab renders, **Then** it is marked not
   reached and shows no fabricated artifacts.
5. **Given** the engineer selects a different tab, **When** the tab changes, **Then** the selected
   state is reflected in the application's navigation so the view can be returned to directly.

---

### User Story 3 - Read the artifacts behind each state (Priority: P2)

Within a state's tab, the engineer sees the concrete evidence for that state: specification or
design documents held as markdown files in the repository, ticket fields and comments pulled from
the issue tracker, and the results of automated test runs. Each artifact shows where it came from
and when it was last reconciled, so the engineer can trust what they are reading or know that it
is stale.

**Why this priority**: Artifacts are what make a state meaningful rather than a label. Delivered
alongside Story 2, but separable — the tabs are useful with gate results alone.

**Independent Test**: Configure a state with one markdown artifact, one issue-tracker artifact,
and one test-result artifact, then confirm all three render with correct provenance and
reconciliation time, and that an unreadable artifact reports the failure rather than rendering
blank.

**Acceptance Scenarios**:

1. **Given** a state declaring a markdown artifact that exists in the repository, **When** the tab
   opens, **Then** the document renders with its source path and last-reconciled time.
2. **Given** a state declaring an issue-tracker artifact, **When** the tab opens, **Then** the
   tracker content renders, attributed to the tracker.
3. **Given** a state declaring an automated test result, **When** the tab opens, **Then** the run
   outcome renders with enough detail to tell passing from failing.
4. **Given** a declared artifact that is missing or unreadable, **When** the tab opens, **Then**
   the artifact slot states what is missing and why, and the rest of the tab still renders.
5. **Given** artifact content originating outside the application, **When** it renders, **Then**
   no active content from that source is executed.

---

### User Story 4 - Manage the repositories using an SDLC (Priority: P3)

The engineer opens a separate view listing every registered repository, grouped by the SDLC
definition it follows. From here they can register a new repository, see which SDLC each one uses,
and open a repository's configuration — including the gate definitions that SDLC declares — to
review and adjust the settings that repository needs. Configuration problems are reported against
the specific field that is wrong.

**Why this priority**: Needed to onboard the second and subsequent repositories, but a single
manually configured repository is enough to deliver Stories 1 through 3.

**Independent Test**: Register a repository with a valid SDLC configuration and a second with a
malformed one; confirm the first appears under its SDLC with editable configuration and the
second is listed with a validation error naming the offending field.

**Acceptance Scenarios**:

1. **Given** three registered repositories where two share an SDLC definition, **When** the view
   opens, **Then** repositories are grouped by SDLC with the shared definition listing both.
2. **Given** a repository whose SDLC declares configurable gates, **When** the engineer opens its
   configuration, **Then** each gate is listed with its current setting for that repository.
3. **Given** an invalid configuration value, **When** the engineer saves, **Then** the save is
   rejected with a message naming the field and the reason, and the prior configuration is
   retained.
4. **Given** a repository whose configuration references a provider with no credentials, **When**
   the view renders, **Then** it reports which provider needs configuring rather than failing.

---

### User Story 5 - Discuss a state in context (Priority: P4)

Each state tab carries a conversation console scoped to that state. The engineer can ask questions
about the state they are looking at — what a gate checked, what an artifact says, why the item
stalled — and the conversation for that state persists, so returning to the tab continues where it
left off rather than starting over. In v1.0 the console explains; it does not act.

**Why this priority**: The most distinctive feature of both reference projects and the reason
their dashboards feel like a workbench rather than a report. It is also the largest and riskiest
piece of work here, and Stories 1 through 4 deliver a coherent product without it. The advisory
form is a deliberate first step toward the supervised acting console described under Planned
Direction.

**Independent Test**: Open a state tab, hold a short conversation, navigate to another item and
back, and confirm the earlier conversation is still present and distinct from other states'
conversations.

**Acceptance Scenarios**:

1. **Given** an engineer viewing a state tab, **When** they send a message in that tab's console,
   **Then** the reply appears in that console and nowhere else.
2. **Given** a state with prior conversation, **When** the engineer returns to that tab, **Then**
   the earlier transcript is restored.
3. **Given** two different states of the same item, **When** each console is opened, **Then**
   their transcripts are separate.
4. **Given** the console is unavailable or unconfigured, **When** a state tab opens, **Then** the
   rest of the tab renders normally and the console reports that it is unavailable.
5. **Given** the engineer asks the console to change something, **When** it responds, **Then** it
   explains where that change must be made and makes no change itself.

---

### Edge Cases

- **The SDLC definition changes while items are in flight.** An item sits in a state that the
  edited definition no longer contains. The item must remain visible and report that its recorded
  state is no longer defined, rather than disappearing from the list or being silently reassigned.
- **The system of record reports a status with no matching state.** An issue tracker returns a
  status the SDLC definition does not map. The item is listed as unmapped with the raw value shown,
  not coerced into the nearest state.
- **Two providers disagree.** A workflow composes markdown files and an issue tracker, and they
  report different states for the same item. The provider the definition declares as owning that
  field wins, and the disagreement is surfaced rather than hidden.
- **A provider is unreachable or its credentials have expired.** Items sourced from that provider
  render from the last reconciled data, marked stale, with the failure reported and a retry
  available. Items from healthy providers are unaffected.
- **No credentials are configured at all.** The application still opens; workflows requiring an
  unconfigured provider prompt for configuration naming the provider.
- **An item needs input but the engineer is not looking at the app.** The attention signal must
  survive a restart — it is derived from the system of record, not from session memory.
- **A repository is registered twice**, or registered at a path that no longer exists.
- **Very large item volume.** An engineer with many hundreds of active items across repositories
  still gets a usable list, ordered so that items needing attention appear first.
- **An artifact is enormous** — a very long markdown file or a test run with thousands of cases —
  and must not make the tab unusable.
- **The local cache is deleted** while the application is running or between runs.

## Requirements *(mandatory)*

### Functional Requirements

#### Work item aggregation

- **FR-001**: System MUST present a single list of active work items drawn from every registered
  repository, regardless of which SDLC definition each repository follows.
- **FR-001a**: System MUST scope the list to the engineer's own work, with ownership determined by
  the provider that supplies the item: for issue-tracker-backed items, assignment to the engineer
  in that tracker; for file-backed items, the presence in the repository of the markdown artifacts
  that workflow declares for the item. An item qualifying under any of its workflow's providers
  MUST be listed once, not once per qualifying provider.
- **FR-002**: System MUST show, for each listed item, its identifier, title, the SDLC it follows,
  its current state, and the time that item was last reconciled with its system of record.
- **FR-003**: System MUST determine each item's current state from the system of record designated
  by that item's workflow definition, and MUST NOT derive state from application-local storage.
- **FR-004**: System MUST allow the engineer to filter the list by repository, by SDLC, and by
  state, and to search it by item identifier or title.
- **FR-005**: System MUST treat an item whose recorded state has no counterpart in its SDLC
  definition as unmapped, listing it with its raw recorded value.

#### Attention signals

- **FR-006**: System MUST mark items that cannot progress without human action, distinguishing at
  minimum "awaiting human input" from "gate failed".
- **FR-007**: System MUST derive attention markers from the workflow definition and recorded gate
  results, so that the markers are reproducible after a restart.
- **FR-008**: System MUST order the list so items carrying attention markers appear before items
  progressing normally.
- **FR-009**: System MUST show a count of items currently needing attention.
- **FR-010**: System MUST update item state and attention markers as the underlying sources change,
  without requiring the engineer to restart the application.

#### State navigation and progress

- **FR-011**: System MUST present the states of an item's SDLC as an ordered set of tabs, derived
  entirely from that item's workflow definition.
- **FR-012**: System MUST open the detail view on the state the item currently occupies.
- **FR-013**: System MUST mark each state as completed, current, blocked, or not reached.
- **FR-014**: System MUST show, for each state, every gate that state declares and each gate's
  result, distinguishing passed, failed, and not evaluated. Absence of a result MUST NOT render as
  a pass.
- **FR-015**: System MUST reflect the selected item and state in application navigation so a
  particular state view can be returned to directly.
- **FR-016**: System MUST render the detail view for any SDLC definition it can load, without
  prior knowledge of that definition's state names, gate names, or ordering.

#### Artifacts

- **FR-017**: System MUST render the artifacts a state declares, supporting at minimum markdown
  documents held in the repository, content retrieved from an issue tracker, and automated test
  results.
- **FR-018**: System MUST attribute every artifact to its source and show when it was last
  reconciled.
- **FR-019**: System MUST report a missing, unreadable, or unauthorised artifact in place, naming
  what failed, while continuing to render the rest of the state.
- **FR-020**: System MUST treat all artifact content as untrusted and MUST NOT execute active
  content originating from a repository, an issue tracker, or a test result.
- **FR-021**: System MUST remain usable when an artifact is very large, without blocking the rest
  of the view.

#### Repositories and configuration

- **FR-022**: System MUST provide a view listing every registered repository grouped by the SDLC
  definition it follows.
- **FR-023**: Users MUST be able to register a repository, associate it with an SDLC definition,
  and remove a registration.
- **FR-024**: System MUST present the configuration a repository's SDLC requires, including the
  gates that definition declares, and allow the engineer to edit and save it.
- **FR-025**: System MUST validate an SDLC definition and a repository configuration before use,
  rejecting an invalid one with a message naming the offending field and the reason, and MUST NOT
  partially apply an invalid configuration.
- **FR-026**: System MUST report which providers a repository's configuration requires and which
  of those are not yet configured.

#### Conversation console

- **FR-027**: System MUST provide, within each state tab, a conversation console scoped to that
  state of that item.
- **FR-028**: System MUST persist each console's transcript so that returning to a state tab
  restores the prior conversation.
- **FR-029**: System MUST keep consoles for different states and different items separate from one
  another.
- **FR-030**: System MUST render the rest of a state tab normally when the console is unavailable
  or unconfigured, reporting the console's unavailability in place.
- **FR-031**: System MUST make available to a console the state it is scoped to, that state's
  artifacts, and that state's gate results.
- **FR-031a**: The console is advisory in v1.0: it answers questions about the state in view and
  MUST NOT modify work items, repositories, artifacts, or configuration, and MUST NOT execute
  tools on the engineer's machine.

#### Acting on items

- **FR-032**: System MUST record every state transition and gate evaluation it observes as a
  durable, inspectable local record showing what changed, when, and why a gate passed or failed.
- **FR-033**: System MUST NOT write back to a system of record unless the workflow definition
  explicitly opts in to that write.
- **FR-034**: System MUST be read-only with respect to every system of record in v1.0. It observes
  and reports; it performs no state transition, no gate approval or override, and no check retry.
- **FR-034a**: System MUST make its read-only posture legible rather than implicit: where an item
  needs an action the engineer must take elsewhere, the interface MUST say where that action is
  performed rather than presenting a control that does nothing.

#### Availability and trust

- **FR-035**: System MUST start with no provider credentials configured, and MUST prompt for
  configuration naming the missing provider rather than failing.
- **FR-036**: System MUST remain usable for items whose system of record is entirely local when no
  network is available.
- **FR-037**: System MUST continue to serve items from healthy providers when another provider is
  unreachable, marking data from the failing provider as stale and offering a retry.
- **FR-038**: System MUST treat any locally stored copy of work-item data as a cache that can be
  deleted and rebuilt from the systems of record.

### Key Entities

- **SDLC Definition**: A user-authored description of one software development lifecycle: its
  ordered states, the transitions allowed between them, the gates each state must satisfy, and the
  artifacts each state carries. Supplied as configuration; the application ships none of its own.
- **State**: One named stage within an SDLC Definition, carrying zero or more gates and zero or
  more artifact declarations.
- **Gate**: A validation or verification condition attached to a state, with a result of passed,
  failed, or not evaluated, and a record of why.
- **Work Item**: One unit of tracked work following one SDLC Definition, belonging to one
  repository, occupying one state at a time, with a history of the transitions it has made.
- **Artifact**: A piece of evidence attached to a state of a work item — a markdown document, issue
  tracker content, or an automated test result — carrying its source and last-reconciled time.
- **Repository**: A registered codebase associated with one SDLC Definition, holding the
  configuration that definition requires of it.
- **Provider**: A source of work items, states, or artifacts — the local filesystem, an issue
  tracker, a source host, or a test result store — declared by a workflow definition.
- **Attention Signal**: A derived indication that a work item cannot progress without human
  action, distinguishing awaiting-input from gate-failure.
- **Conversation**: A persisted transcript scoped to one state of one work item.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From opening the application, an engineer can identify every work item awaiting their
  input within 10 seconds, without opening any individual item.
- **SC-002**: An engineer can determine how far a given work item has progressed, and which state
  it stalled in, within 15 seconds of selecting it.
- **SC-003**: A new SDLC definition with states, gates, and artifacts the application has never
  seen can be adopted and its items tracked correctly with configuration changes only, and no
  change to the application itself.
- **SC-004**: An engineer can register a repository and see its work items appear in the list in
  under 5 minutes, without consulting documentation beyond what the application presents.
- **SC-005**: 100% of gates displayed as passed correspond to a recorded passing evaluation; no
  gate lacking a result is ever displayed as passed.
- **SC-006**: The application opens and presents a usable, correctly-labelled interface with zero
  provider credentials configured.
- **SC-007**: With one provider unreachable, 100% of items sourced from healthy providers remain
  visible and correctly stated, and every item from the failing provider is marked stale.
- **SC-008**: An engineer supervising at least 200 active items across at least 3 repositories can
  still complete SC-001 within its stated time.
- **SC-009**: Deleting all locally cached data and reopening the application reproduces the same
  item states and gate results, demonstrating the systems of record remain authoritative.
- **SC-010**: Every state, gate, and artifact the interface displays traces to the loaded SDLC
  definition; none is hardcoded by the application.
- **SC-011**: Across a full session of normal use, the application performs zero modifications to
  any system of record — no file in a repository altered, no ticket updated, no comment posted.
- **SC-012**: Every item listed qualifies under a stated ownership rule, and an item the engineer
  neither owns in the tracker nor holds declared markdown artifacts for does not appear.

## Planned Direction (beyond v1.0)

Two capabilities are deliberately deferred, but their end states are known and are recorded here
so that v1.0 is not designed in a way that forecloses them. These are not v1.0 requirements; they
are constraints on how the v1.0 requirements should be satisfied.

- **Acting on work items.** v1.0 observes only (FR-034). The intended end state is that an
  engineer can advance a state, approve or override a gate, and retry a failed check from the
  dashboard, with those changes written back to the system of record under the workflow's explicit
  opt-in. Consequences for v1.0: the local transition record of FR-032 should capture what a later
  write would need rather than only what the current view displays; the provider boundary should
  be shaped so that adding write operations does not change how items are read; and no part of the
  interface should assume item state is immutable from the engineer's side.
- **A console that acts.** v1.0's console is advisory (FR-031a). The intended end state is a
  supervised session per state, able to use tools with the engineer approving each action inline,
  comparable to the console docks in both reference projects. Consequences for v1.0: transcripts
  should be persisted in a form a later session-based console can continue rather than discard, and
  the scoping rule — one conversation per state per item — should hold from the start, because
  scoping is the part that is expensive to retrofit.

## Assumptions

- **The engineer is the sole user of their own installation.** There is no multi-user access
  control, no shared server, and no notion of administering another person's work in v1.0.
- **Ownership is a per-provider rule, not a single global one.** A tracker-backed item is the
  engineer's because the tracker says it is assigned to them; a file-backed item is theirs because
  the declared markdown artifacts for it exist in their repository. Workflows composing both can
  qualify an item either way.
- **SDLC definitions are authored outside this application**, as versioned, human-editable files
  of the kind the reference SDLC uses — YAML declaring states and gates. v1.0 reads and validates
  them; an in-app definition editor is out of scope.
- **A repository is the unit of registration.** Work items belong to a repository, and a repository
  follows exactly one SDLC definition at a time.
- **Multiple SDLC definitions coexist.** Different registered repositories may follow different
  definitions simultaneously, and the item list spans all of them.
- **Systems of record are external and authoritative**, per the project constitution: markdown
  files in a repository, issue tracker tickets, and test results drive the process. The application
  holds only a rebuildable cache.
- **Attention is declared, not inferred.** The SDLC definition marks which states and gates await
  human input; the application does not guess from heuristics.
- **Reconciliation is periodic and on demand.** Local sources are observed as they change; remote
  sources are polled on an interval and on explicit refresh. Sub-second propagation from a remote
  tracker is not expected.
- **Jira and GitHub are the first integrations**, as the two named in the project's founding
  description. The provider interface admits others without application changes.
- **Automated test results reach the application through a provider** — a file the harness writes
  or a source host's check results — rather than by this application executing tests itself.
- **Artifacts are read-only in v1.0.** Editing a markdown document or a ticket happens in the tool
  that owns it.
- **Historical and archived items are out of scope** beyond what is needed to show a current item's
  completed states. The list is about active work.
- **The conversation console's backing assistant is assumed to be available on the engineer's
  machine** and configured separately; the application does not provision it.

## Dependencies

- One or more SDLC definitions authored in a supported configuration format.
- At least one registered repository containing work items.
- For issue-tracker-backed workflows: credentials for that tracker, supplied by the engineer.
- For test-result artifacts: a provider that publishes results the application can read.
- For the conversation console: a locally available assistant the application can converse with.
