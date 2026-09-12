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
