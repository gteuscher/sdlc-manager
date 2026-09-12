# Design-Judgment Review (T125)

**Feature**: [spec.md](spec.md) · **Date**: 2026-09-11 · **Reviewer**: maintainer

This is the constitution's **single self-attested gate** — principles VII, VIII, IX,
X, and XIII, which govern how code is written and are largely not machine
checkable. The constitution is explicit that they are "reviewed by the maintainer
during planning, **not enforced at merge**", and that this document must say so
plainly rather than imply a reviewer will catch them.

So this is a review, not a certificate. Where a principle is met, the evidence is
given. Where something is marginal, it is named.

**Scope reviewed**: `src/` at 16,828 lines across 5 layers, against `tests/` at
10,623 lines in 30 files (611 tests). Ratio of test to source: 0.63.

---

## Summary

| Principle | Verdict | Evidence |
|---|---|---|
| VII. Optimize for Deletion | **Pass, with one file flagged** | No speculative abstraction; four mandated interfaces only. `Repositories.tsx` at 723 lines is the outlier. |
| VIII. Make Dependencies Explicit | **Pass, strongly** | Zero module-level mutable state across the whole tree. Lint-enforced. |
| IX. The Network Is the Boundary | **Pass, strongly** | Zod at all three boundaries; zero `dangerouslySetInnerHTML`; zero `any`. |
| X. Render What You Can Prove | **Pass, after two fixes made during review** | Both gaps found were real and are fixed, not waived. |
| XIII. State Lives at the Edge | **Pass, strongly** | No global store of any kind. URL state used for exactly the things the spec names. |

---

## VII. Optimize for Deletion, Not Extension

**What the principle asks**: a component small enough that one engineer can delete
and rewrite it in a day; no speculative abstractions; duplication below three
occurrences cheaper than the wrong abstraction.

**Evidence for**: The only load-bearing abstractions are the four the constitution
itself mandates — the workflow-engine, gate, adapter, and storage-provider
interfaces. There are no higher-order components, no render-prop towers, and no
generic `<Wrapper>` layers. The single package was not split into a monorepo, and
research.md §3 records why.

Two places where duplication was correctly left alone: the three provider fakes are
thin wrappers over one shared implementation rather than three copies *or* a
hierarchy; and the "cap a large collection and count the remainder" treatment
appears in both `TestResultsArtifact` and (planned) the hierarchy view — two
occurrences, below the threshold at which extraction pays.

**Flagged**: `src/renderer/routes/Repositories.tsx` at **723 lines** is the largest
renderer file and does four separable jobs — registration, per-repository
configuration, credential entry, and the installed-package list. It is under the
"rewrite in a day" bar, so this is not a violation, but it is the file most likely
to cross that bar next. If it grows again, the registration form is the natural
thing to lift out.

The three provider adapters (github 1,092, jira 858, filesystem 809) are large but
correctly so: most of their bulk is Zod response schemas and endpoint surface, which
is exactly the volatile, isolated code Principle III wants quarantined. Each is
deletable in a day because nothing outside it knows how it works.

**No action required.**

## VIII. Make Dependencies Explicit

**What the principle asks**: no hidden coupling via module-level state, no implicit
context providers, every prop in the signature, every hook's dependencies declared,
no import-time side effects.

**Evidence for**, and this one is unusually clean:

- **Zero module-level mutable state.** A scan for top-level `let` or `var` across
  every `.ts` and `.tsx` file in `src/` returns nothing. Every stateful module —
  the cache, the registry, the secret store, the change bus, each provider, the
  reconciler — holds its state in a closure returned by a factory.
- **No import-time side effects**, enforced by lint rather than convention. The two
  exemptions are `src/preload/index.ts` and `src/main/entry.ts`, which exist in
  order to run on load; both are named explicitly in `eslint.config.js`.
- **No implicit context.** The renderer has no `createContext` call anywhere.
- Injection is used where it matters: `createServices` takes its `userDataDir`,
  `safeStorage`, `fetch`, clock, package roots, and provider factories, so the whole
  graph is constructible in a node test with no Electron — which is what let gates 3
  and 4 be written as ordinary unit tests.

**No action required.** This is the principle the codebase honours most completely.

## IX. The Network Is the Boundary

**What the principle asks**: every fetch a contract; schemas validated at the
boundary rather than scattered through components; every external producer treated
as untrusted.

**Evidence for**:

- Zod is applied at all three boundaries named in research.md §4 — manifest parsing,
  provider responses, and IPC payloads — and the IPC case validates **both
  directions**, because main's replies carry provider data that was itself
  untrusted.
- **Zero `dangerouslySetInnerHTML`** in the entire tree. The markdown-safety test
  asserts this over the source as well as behaviourally, so the behavioural
  assertions cannot silently stop being sufficient.
- **Zero `any`.** Two grep hits exist and both are the English word "any" inside
  comments. No unchecked type assertions were justified in a commit message because
  none were needed.
- Credentials are structurally unable to cross the bridge: a test walks every
  published reply schema for credential-shaped keys and finds none, and two
  meta-tests prove that detector would catch a leak.

**Observation, not a finding**: the `github` and `jira` adapters each scrub their
credential out of any message before it leaves, including status excerpts echoed
back by the remote API. That is defence beyond what the principle requires and is
worth keeping.

**No action required.**

## X. Render What You Can Prove

**What the principle asks**: no loading spinner without a timeout, no error state
without a retry path, no empty state without copy; provider-bound actions bounded
at ten seconds.

**Two real gaps were found during this review. Both are fixed, not waived.**

1. **The advisory console reported its unavailability only after the first
   question.** Since the application ships with no assistant configured, that was
   not an edge case — it was the default first-run experience, and it is the
   "silent empty state" Principle I names. Fixed by adding a read-only
   `consoleAvailable()` health probe so the console reports itself when the tab
   opens, naming the missing provider. A secondary improvement came with it: the
   internal `available(): boolean` became `health(): ProviderHealth`, because a
   boolean cannot name a provider or say what it needs.

2. **The "no SDLC packages found" empty state was a dead end.** It said to install a
   package and reopen the view, without naming the directories searched or the
   `SDLC_PACKAGE_PATHS` override. A user hit this in practice during the review.
   Fixed by reporting the searched paths and the override.

**Evidence for elsewhere**: every provider-bound wait is bounded by
`REQUEST_CEILING_MS` (10s, the constitution's default ceiling); artifact failures
render in place while the rest of the state still renders; a state the item has not
reached shows no fabricated artifacts; a parent with no children renders as an
ordinary row rather than an empty group.

**Lesson worth recording**: both gaps were in *the state the user sees before
anything is configured*. That state is the hardest to keep honest, because every
developer's machine is already configured. It deserves deliberate attention in any
future review rather than being inferred from the happy path.

## XIII. State Lives at the Edge It Is Needed

**What the principle asks**: URL state is URL state; server state is cache, not
store; form state is local; global client state is the last resort.

**Evidence for**:

- **There is no global client store of any kind** — no Redux, no Zustand, no
  context. The "last resort" was never reached, so no written justification was ever
  owed.
- **URL state** holds exactly what the spec says it should: the selected item and
  state tab (FR-015), and the list's filters and search. A test mounts at a
  pre-filtered URL and asserts the list comes up filtered, so the principle is
  verified behaviourally rather than by inspection.
- **Server state is a cache.** TanStack Query over the IPC surface, with change
  events arriving as *invalidations, not payloads* — so the renderer never gains a
  second source of truth. A test asserts emitted events carry no item content.
- **Form state is local**, and deliberately discarded: the console's draft question
  is dropped on unmount while the transcript survives in the cache, which is the
  correct split.

One detail worth noting as good judgement rather than compliance: the credential
form keeps its secret out of React state entirely (uncontrolled input, read through
a ref at submit) *and* calls `mutation.reset()` afterwards, because TanStack Query
retains a mutation's last variables — which would have been the plaintext.

**No action required.**

---

## Automation debt

The constitution says a self-attested gate is tracked as automation debt, and that
where a piece of one can become a lint rule it should. Two candidates from this
review:

1. **Principle IX's "no `dangerouslySetInnerHTML`"** is already asserted by a test
   over the source tree. It would be better as a lint rule, where it would fail at
   the point of writing rather than at the point of running the suite.
2. **Principle VII's file-size heuristic** could be a warn-level lint rule with a
   generous threshold — enough to notice `Repositories.tsx` growing again, not
   enough to nag.

Neither is urgent. Both are cheaper than the review they would replace.

## Verdict

**Pass.** Five principles reviewed, two genuine defects found and fixed during the
review, one file flagged for future attention, two lint rules proposed as automation
debt. Nothing was waived.

---

# Appendix: Feature 003, the Two-Pane Workbench (T047)

**Feature**: [003 spec.md](../003-two-pane-workbench/spec.md) · **Date**: 2026-09-12

The same self-attested gate, re-run over `src/renderer` after the list and the
detail became two panes of one view. This is a narrower review than the one above:
003 touched the renderer only, so principles IX and XIII are re-examined where the
feature moved something, and VII, VIII and X are re-examined in full for the
changed files.

003's tasks.md poses the review's central question directly, which is unusual and
worth honouring literally:

> did `Workbench.tsx` stay arrangement-only, or did it accumulate both panes'
> responsibilities?

## VII. Optimize for Deletion, Not Extension

**The stated test**: deleting `Workbench.tsx` and restoring two route entries
returns the product to two full-width pages, with no change to either pane's
source.

**Does it hold?** Yes, and it was checked rather than assumed. Removing the shell
would require: deleting `Workbench.tsx`, `PaneToggle.tsx`, `CollapsedRail.tsx`,
`NoSelection.tsx`, `usePaneState.ts` and one delimited section of `styles.css`,
then restoring two sibling `<Route>` entries in `App.tsx`. `Items.tsx` and
`ItemDetail.tsx` would keep working untouched — both of their new parameters
(`selectedKey`, `selected`) are optional and default to the pre-003 behaviour,
which is exactly why 001's suites for them still pass unedited.

**Size**: `Workbench.tsx` is 224 lines, of which **116 are code** and the balance
is commentary. It holds a grid, a toggle, a scroll offset, a media query and an
outlet. It is comfortably inside "one engineer could delete and rewrite it in a
day".

**Two deviations from tasks.md, both taken deliberately, both in this principle's
service.** They are recorded here rather than buried, because each moved work
*out* of the shell that the task list had placed *in* it:

1. **T027 said render the attention count in `Workbench.tsx`.** Doing so would
   have made the shell call `useItems()` — a data read, which T013 forbids in the
   same breath. The count lives in `CollapsedRail.tsx` (23 code lines) instead,
   and the shell places it. The rejected simpler alternative was to let the shell
   fetch; it was rejected because it is the first step of exactly the accretion
   this principle warns about.
2. **T034 said derive the out-of-filter selection in `Workbench.tsx`.** That
   requires the *filtered* list, which only `Items` computes. Doing it in the
   shell would have meant duplicating the whole filter pipeline — four URL
   parameters and the `matches()` predicate — into a component whose stated job is
   arrangement. It is two derived booleans in `Items.tsx` instead. The rejected
   alternative was exporting `matches()` from `Items` and re-running it in the
   shell: the same computation in two places, guaranteed to diverge.

**Verdict: pass.** The shell did not accumulate. Both times the task list pulled
toward the god component, the work was pushed back down.

## VIII. Make Dependencies Explicit

**Verdict: pass.** No module-level mutable state was added. `usePaneState` reads
storage through a lazy `useState` initialiser rather than at import, because
Principle VIII prohibits import-time side effects and a value captured at import
would be stale for any test that seeded storage afterwards.

The one judgement worth naming: `ItemRow` takes `selected` as a **prop** rather
than reading the route. A row that called `useParams` would be a row that cannot
render without a router — and 001's `ItemList` suite renders rows by the dozen.
The shell reads the route once and passes the answer down.

## X. Render What You Can Prove

**Verdict: pass, and the feature added the product's most-seen empty state.**
`NoSelection` is half the window every time the application opens, and it renders
copy saying what selecting will do rather than a blank column. It is a separate
component rather than a branch inside `ItemDetail` for a Principle XII reason:
`ItemDetail` is the lazy boundary holding ~50 KB of markdown machinery, and a
branch inside it would have pulled that chunk down to render a paragraph.

Three other places where the feature had to choose between showing something and
showing nothing, and chose the honest option:

- **The collapsed rail renders nothing until the item query succeeds.** A count
  that guessed zero would be a claim the application cannot yet prove — and the
  specific claim "nothing needs you", which is the worst one to get wrong.
- **The rail's count is unfiltered.** Collapsed, the filter controls are not on
  screen, so a filtered count could tell an engineer to stop looking while
  something waited behind a filter they cannot see.
- **A vanished item is not an error.** `not_found` now renders the deliberate
  "nothing" treatment with a way back, rather than a failure with a retry that
  cannot succeed.

## XIII. State Lives at the Edge It Is Needed

**Verdict: pass, with the constitution's required written justification supplied.**

003 introduced the first persisted client preference in this product:
`sdlc.workbench.listCollapsed`. The principle calls global client state a last
resort requiring written justification; the justification is in
[003's research.md §3](../003-two-pane-workbench/research.md), restated in the
hook's own docblock, and it is not hand-waving — FR-011 requires the state to
survive a **restart**, which a URL cannot do, and the value describes the
engineer's furniture rather than any work item.

The dividing line the feature drew is legible and worth keeping: **the URL holds
what another person or another session should be able to arrive at; local storage
holds what only this engineer at this desk cares about.** Selection, filters,
search and the state tab all stayed in the URL.

Still no store, no context, no module-level variable. One boolean, read by one
component.

**One correctness area that belongs under this principle rather than under a
feature — and the more instructive half of it was nearly missed.**

`Items` read `?state=` as the list filter and `ItemDetail` read `?state=` as the
selected tab. As sibling routes they never shared a query string and the collision
was invisible; as two panes of one view they read and write the same URL. The
detail's parameter is now `?tab=`. data-model.md caught that half by enumerating
where each value lives instead of assuming it.

**It did not catch the other half, and the other half is the one worth learning
from.** Renaming the parameter stopped the tab from filtering the list. It did
nothing about the list *erasing* the tab — because `setFilter` built a fresh
`URLSearchParams` and replaced the whole query string, discarding every key the
list does not own. Correct while the list was a page that owned its URL; silently
destructive the moment it became a pane. Every filter change and **every keystroke
in the search box** deleted `?tab=` and snapped the open item back to the state it
occupies.

Three things about how it was found are worth recording:

- **The planned test suite did not catch it.** T030 asserted "filtering changes
  the list and not the detail" and passed throughout, because the detail kept
  showing the same *item*. Only its tab reverted. The assertion was true and the
  behaviour was wrong.
- **It was found by walking the quickstart against a built application**, which is
  precisely what 003's tasks.md said T040 and T041 were for and precisely the step
  easiest to skip once the suite is green.
- **The diagnosis was one-directional.** research.md §2 described the collision as
  a single problem with a single fix. It was two problems that fail through
  different code, and naming it once made the second invisible. A collision
  between two writers of shared state should be enumerated **per writer**, not per
  key.

The fix and its regression test — which exercises both directions and all three of
the list's write paths, and was verified against a negative control — are recorded
in [003's baseline.md](../003-two-pane-workbench/baseline.md) under T042.

## Automation debt

One new candidate, added to the two still outstanding above:

3. **The pane-preference key should have exactly one reader.** "Nothing outside
   the hook reads `sdlc.workbench.listCollapsed`" is currently a claim asserted by
   a test over the source tree. Like Principle IX's `dangerouslySetInnerHTML`
   check, it would be better as a lint rule, failing at the point of writing.

## Verdict

**Pass.** Four principles re-reviewed over the changed renderer. No violation
found, no waiver taken. Two task-list instructions were deviated from, both to
keep the shell from accumulating responsibilities, and both are recorded above
with the simpler alternative that was rejected. One real defect was found — by
walking the quickstart, not by the suite — fixed, and covered by a regression test
proven against a negative control.

The thing most worth watching is not in the code yet: `Workbench.tsx` is small and
correct *today*. Its failure mode is accretion, one reasonable-looking addition at
a time, and the boundary test in this section is the only thing that will notice.

---

# Appendix: Feature 004, Bounding the Active List (T044)

**Feature**: [004 spec.md](../004-bound-active-list/spec.md) · **Date**: 2026-09-12

The same self-attested gate, re-run over a feature whose entire subject is a
*lifecycle property*. 004's tasks.md poses the two questions this review has to
answer:

> did anything end up storing finishedness, and did the renderer stay a consumer
> of the answer rather than a second judge of it?

## VI. Storage Follows the SDLC — the load-bearing one here

**What the principle asks**: nothing competes with the system of record; any
cache is non-authoritative, deletable, and rebuildable.

**The claim under review**: finishedness is derived on every read from a
definition already loaded, and written down nowhere.

**Evidence, and it is machine-checked rather than attested.** `terminal` is
computed in `toSummary` from the repository's own definition and appears in no
cache, no config file, and no persisted record. What makes this more than a
promise is where the test went: `comparable()` in `cache.rebuild.test.ts` — the
projection gate 4 compares before and after a full cache wipe. A stored `terminal`
would survive the wipe and could then disagree with the definition that owns it,
which is exactly the failure this principle exists to prevent, and exactly what
that test would catch.

**Verdict: pass**, and unusually well evidenced for a design-judgment principle.
This is a case where a self-attested claim was successfully turned into a
machine-enforced one, which is what the constitution asks for whenever it is
possible.

Two consequences fall out of deriving rather than recording, and both are
requirements met for free rather than implemented:

- **Reopened work returns by itself** (FR-017). An item that leaves a terminal
  state stops reporting `true` on the next reconciliation. Nothing is invalidated
  because nothing was remembered.
- **Correcting a manifest clears its report** (FR-013), for the same reason one
  level up.

## VII. Optimize for Deletion, Not Extension

**Verdict: pass.** The whole feature is three fields on existing shapes, one
condition in `matches`, one checkbox, one row marking, and one small component.
No new channel, no new entity, no new file in `src/` at all — the only new file
anywhere is a fixture flag's worth of code in `scripts/fixture.ts`.

Removing it means deleting three fields and their two readers. Nothing was
restructured to accommodate it, which is the honest test.

## VIII. Make Dependencies Explicit

**Verdict: pass.** `ItemRow` receives `item.terminal` and renders it. It does not
acquire a definition, consult a lifecycle, or reach for a router to find out. The
same discipline 003 applied to `selected` applies here for the same reason: a
component that needed a definition could not be rendered by a suite that has none.

## X. Render What You Can Prove — and one defect found late

**Two deliberate refusals**, both of which improved the specification:

- **Unknowable finishedness resolves to "not finished."** An unmapped item has no
  declared state to consult; a repository whose definition failed to load cannot
  answer for any of its items. Both keep the work visible, which is the answer
  that hides nothing.
- **No count of hidden finished work crosses the wire.** The renderer cannot know
  one without fetching the very thing it is withholding. This forced an amendment
  to FR-002 during analysis: the requirement had asked the list to convey that
  finished work *exists*, which no honest implementation could do. It now conveys
  only that finished work is **not shown**, and explicitly forbids claiming
  otherwise. A control that promised finished work would be lying in every
  repository that has none.

**And one genuine defect, found by a test rather than by review.** The filter bar
was suppressed whenever the list was empty and unfiltered — correct while an empty
list meant "there is nothing here", and wrong the moment an empty list could mean
"everything is finished and hidden". The empty state told the engineer to show
finished work *while removing the only control that could*, leaving a hand-edited
address as the sole way out — against SC-001 in as many words. The suppression now
applies only where there is genuinely nothing to reveal: a pending first paint, a
failed load, and the true first run.

Worth naming plainly: **this was written by the same hand that wrote the copy
pointing at the control**, in the same file, minutes apart, and neither review nor
typecheck noticed. A component test did.

## XIII. State Lives at the Edge It Is Needed

**Verdict: pass.** `?finished=1` is URL state, following the line 003 drew — the
URL holds what another person or another session should be able to arrive at. It
is a filter, and every other filter here is already a query parameter.

The interesting part is structural. 003 shipped a defect where the list rebuilt
its whole query string and erased the detail pane's `?tab=`; the fix touched only
the list's own keys, which works until someone adds a key and forgets. 004 added
the fifth key and turned the implicit set into a named constant, `FILTER_PARAMS`,
with the reason written above it. That is the right response to a defect: not just
a fix, but a change that makes the *next* instance harder to write.

## The pattern this project keeps producing, and a rule for it

Four times now, this project has produced an assertion that passes without testing
its claim:

1. **001** satisfied all forty-eight requirements while not building the product
   its own Input described — "left pane / right pane" never became a requirement.
2. **003's T030** asserted that filtering did not change the detail pane. True —
   and the open tab was silently reverting the whole time.
3. **004's first FR-002 test** asserted a control was present. FR-002 was about
   what the control *says*.
4. **003's `Workbench.test.tsx`** counted bridge calls against a stub whose
   overrides had replaced the counting. Three "was not re-fetched" assertions were
   comparing `0` to `0`.

They share one shape: **the assertion is about the mechanism, and the requirement
is about the meaning.** The mechanism is easy to observe, so it is what gets
asserted, and it stays true while the meaning quietly departs.

No lint rule can catch that. What can help is a habit, and it is cheap enough to
adopt: **when a test cites an FR, state in one line what would have to be false
for it to fail.** If that sentence is not the requirement, the test is measuring
something adjacent to it. All four cases above would have been caught by writing
that sentence — and where 004's tasks did write it (T010a's warning), the defect
was caught before it shipped.

## Automation debt

Two candidates, added to the three outstanding above:

4. **`createBridgeStub` should keep tracking calls through an override.** The
   current behaviour — an override silently replaces the call tracking — turned
   three assertions vacuous and would do it again. This is a fixable harness
   defect, not a habit to remember.
5. **A rule that every field on a wire type is required unless justified.**
   004's `terminal` was made required deliberately, so that "unknown means not
   finished" is decided in one process rather than by every consumer. An optional
   field would have compiled and quietly distributed that decision.

## The rule the two link defects produced

004 found a second instance of 003's collision, and it is worth stating as a rule
because the two halves are not obviously the same problem.

003 fixed **the list clobbering the detail's key**: `setFilter` rebuilt the whole
query string and erased `?tab=`. Nobody then checked the reverse, and the reverse
was also broken — `ItemRow`'s `<Link to={"/items/" + key}>` is a bare string, and
a string location discards the query string entirely. Selecting a row cleared
every filter, the search, and the finished flag. `ItemDetail`'s back link had the
same shape.

It survived a release because until 004 the only casualties were filters, and a
list that changes after you touch a filter looks like a list you changed. 004's
fifth key is the one whose loss changes *what the list contains* — 14 rows to 12,
under the cursor, at the moment of reaching for one.

**The rule**: a component that owns a set of URL keys must state both halves —
what it writes, and what it carries. `Items.tsx` now has `writeFilterKeys` and
`listSearch` beside each other, deriving from one `FILTER_PARAMS` constant, so the
next key added is added once.

**And the general form, which is the more useful lesson**: when a defect is found
in one direction of a two-way relationship, the other direction is unproven, not
absent. 003's fix was correct and its scope was assumed.

## FR-013 is not met, and is recorded rather than waived

Correcting a manifest does not clear its report until the application restarts.
`reconcileRepository` re-reads items but never re-scans packages; only `reload()`
does, and no UI control reaches it. The condition is pre-existing — every manifest
edit has always been stale until restart — and FR-013 is merely the first
requirement to depend on it.

It is left open deliberately. The fix is a decision about *when* a package
re-scan should happen, in a layer this feature's plan did not scope, and making
that call unreviewed at the end of an implementation phase is how a reconcile loop
acquires behaviour nobody specified. **The requirement was not weakened to match
the code.** It is correct; the code does not yet satisfy it, and
[004's baseline.md](../004-bound-active-list/baseline.md) says so under T039.

This is the honest form of an unmet requirement, and worth keeping as the pattern:
name it, locate it, explain why it was not fixed here, and leave the requirement
standing.

## Verdict

**Pass, with one requirement recorded as unmet.** Five principles reviewed over a
feature crossing three layers. No violation, no waiver. Two real defects found —
one by a component test, one by walking the quickstart against a built
application — both fixed and both now covered by tests verified against negative
controls. One requirement amended during analysis because the design could not
honestly satisfy it, one recorded as unmet because the code does not yet satisfy
it, and one pre-existing hole in 003's test harness closed.

The answer to tasks.md's two questions: **nothing stores finishedness**, proven by
gate 4 rather than asserted; and **the renderer stayed a consumer**, proven by a
grep whose every hit reads the field and none decides it.
