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
