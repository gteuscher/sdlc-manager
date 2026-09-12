# SDLC Manager Constitution

## Context and Scope

This is a single-maintainer project evaluating spec-driven development with Spec Kit, by building
a dashboard for user-defined agentic SDLCs. That scope governs proportionality: every rule here
MUST be enforceable by one person with automation. A principle requiring review headcount or
infrastructure disproportionate to that scope MUST be amended or removed rather than quietly
ignored. Amending this document mid-project is expected, not exceptional.

## Core Principles

### I. Local-First Operation (NON-NEGOTIABLE)

The dashboard itself MUST run on a single developer machine with no service to deploy, no hosted
backend of its own, and no administrator privileges. Specifically:

- A fresh clone MUST reach a running application through a documented install step followed by a
  single documented start command.
- An end user MUST be able to install and launch a packaged build without installing Node.js, a
  package manager, a compiler, or any other development toolchain.
- The application MUST NOT require a separately provisioned database server, message broker,
  container runtime, or paid service in order to start.
- The application MUST start with zero third-party credentials configured. Where a loaded
  workflow depends on a provider the user has not configured, the application MUST present an
  actionable configuration prompt naming the missing provider — never a crash, a blank screen, or
  a silent empty state.
- A workflow whose system of record is entirely local (for example, markdown files on disk) MUST
  function with no network access at all.
- The application MUST run on Windows, macOS, and Linux. Path handling, shell invocation, and
  line-ending assumptions MUST be platform-neutral.

This principle governs where the *application* runs, not where the *data* lives; data location is
governed by Principle VI.

Rationale: the product's audience is individual engineers inspecting their own delivery
pipelines. Any deployment or hosting requirement makes the tool unreachable for its users, but
their system of record is frequently not local and cannot be dictated by this project.

### II. Workflows Are Data, Not Code (NON-NEGOTIABLE)

An agentic SDLC — its states, its allowed transitions, and its validation and verification gates —
is user-supplied configuration consumed at runtime. Specifically:

- No state name, transition, gate, or phase ordering may be hardcoded in application logic.
  Code operates on the loaded workflow definition generically.
- A workflow definition MUST be expressible in a versioned, human-editable file format, and the
  application MUST validate it against a published schema before use.
- Invalid definitions MUST be rejected with an error naming the offending field and the reason.
  Partial or silent loading of a malformed workflow is prohibited.
- Adding a new state, gate, or transition to a user's SDLC MUST require editing configuration
  only. If it requires a code change, the design violates this principle.
- Gates are evaluated through a uniform gate interface, so validation gates, verification gates,
  and integration-backed gates are interchangeable from the engine's perspective.

Rationale: the product's stated value is adapting to *various* user-defined agentic SDLCs. A
built-in lifecycle would reduce it to one opinionated workflow.

### III. Integrations Behind Adapter Contracts

Every third-party system (JIRA, GitHub, and any future provider) is reached only through an
adapter that implements a shared, version-controlled interface. Specifically:

- Application and UI code MUST NOT import a vendor SDK or call a vendor HTTP endpoint directly;
  it talks to the adapter interface.
- No integration is required by the application itself. An integration becomes required only
  because a loaded workflow declares it, and it MUST be independently disableable.
- Every adapter MUST ship a fake or in-memory implementation of the same interface, used by tests
  so that no test suite performs live network calls.
- Adding a new provider MUST NOT require changes to workflow-engine or UI code.
- Credentials MUST be read from local user configuration or environment variables, MUST NEVER be
  committed to the repository, and MUST NEVER be written to logs or telemetry.
- Adapter failures (network, auth, rate limit) MUST surface as typed, recoverable errors and MUST
  NOT take down unrelated parts of the dashboard.

An adapter that also serves as a system of record additionally obeys Principle VI. What crosses
the wire is governed by Principle IX.

Rationale: integrations are the most volatile and least controllable part of the system;
isolating them keeps the core deterministic and keeps tests offline.

### IV. Test-First and Fully Testable (NON-NEGOTIABLE)

- Tests are written before the implementation they cover, MUST fail first, and MUST pass only
  once the behavior exists. Red-Green-Refactor is enforced.
- Workflow engine logic — state resolution, transition legality, gate evaluation — MUST be pure
  and unit-testable without rendering a component or touching the network.
- React components MUST be testable through their public behavior: rendered output and user
  interaction. Tests MUST NOT reach into component internals or private state.
- Every storage provider MUST have a fake implementation, and the engine's test suite MUST pass
  against every provider fake without modification. A test that passes for one provider and not
  another indicates a leak of provider specifics into the engine.
- Workflow definitions are untrusted user input: every schema rule MUST have a test asserting
  that a violating definition is rejected at runtime. TypeScript types alone do not satisfy this.
- Every bug fix MUST begin with a regression test that reproduces the defect.
- The full unit test suite MUST run offline and MUST be invocable with a single command.

Rationale: a configuration-driven engine has a large behavior space that only tests can pin
down; untestable coupling between engine, provider, and UI is the main risk to this architecture.

### V. Explicit State and Observable Transitions

- The current state of every tracked work item MUST be derived from the system of record
  designated by the workflow, never from transient UI state or component-local memory.
- Every state transition and gate evaluation MUST produce a durable, inspectable record that
  includes what changed, when, and why the gate passed or failed. Where the system of record can
  hold that record (a file commit, an issue comment or transition), it MUST be written there.
- Gate results MUST distinguish "passed", "failed", and "not evaluated". Absence of a result is
  never treated as success.
- Stale data MUST be visibly stale: the UI MUST indicate when displayed state was last
  reconciled with the system of record.
- Errors surfaced to the user MUST be actionable: what failed, which state or gate, and what the
  user can do next.

Rationale: the dashboard's purpose is to make an agentic pipeline legible to a human, which is
impossible if transitions are implicit, unlogged, or silently out of date.

### VI. Storage Follows the SDLC (NON-NEGOTIABLE)

The system of record is declared by the user's workflow definition. The application does not
choose it and MUST NOT impose one. Specifically:

- If the SDLC distributes markdown files, those files are authoritative and drive the process.
  If the SDLC runs on Jira issues, those issues are authoritative and drive status. Other
  providers (GitHub issues, and future additions) are equally admissible.
- All reads and writes of work-item state MUST pass through a single storage-provider interface.
  The workflow engine MUST remain agnostic to which provider backs it.
- The application MUST NOT maintain a competing authoritative store. Any local database, index,
  or cache is non-authoritative, MUST be safely deletable, and MUST be fully rebuildable from the
  system of record.
- Where a cache disagrees with the system of record, the system of record wins. The application
  MUST NOT silently overwrite the system of record from cached state.
- A single SDLC MUST be able to compose multiple providers — for example, markdown files for
  artifacts alongside Jira for status — with the workflow definition stating which provider owns
  which concern. Ownership of a given field MUST be unambiguous.
- Adding a new provider MUST be possible without changing the workflow engine or the UI.

Rationale: the storage model is the single strongest constraint an SDLC tool can impose on its
users, and imposing one would contradict Principle II. Teams already have a system of record;
this product's job is to read and drive it, not to replace it.

### VII. Optimize for Deletion, Not Extension

A component must be small enough that one engineer can delete and rewrite it in a day. Reject
speculative abstractions (HOCs, render-prop towers, generic `<Wrapper>` layers). Inline until it
hurts, then extract. Duplication below three occurrences is cheaper than the wrong abstraction.

The workflow-engine, gate, adapter, and storage-provider interfaces required by Principles II,
III, and VI are the exception: they are load-bearing boundaries mandated by this constitution,
not speculative extension points. Nothing else inherits that exemption.

### VIII. Make Dependencies Explicit

No hidden coupling via module-level state, no implicit context providers that components
silently rely on. Every prop a component reads is in its signature. Every hook's dependencies are
declared. No import-time side effects.

Rationale: this is what makes Principle IV's "testable without a DOM" achievable in practice —
hidden coupling is the mechanism by which engine logic becomes untestable.

### IX. The Network Is the Boundary

Every fetch is a contract. Requests and responses have schemas with versions. Validation happens
at the boundary, not scattered through components. Treat the server as an untrusted producer:
never render raw server strings, always validate before use.

Provider and integration responses are covered by this rule: Jira issue fields, GitHub issue
bodies, and markdown file contents are all untrusted producer output. Principle III governs *how*
external calls are made; this principle governs *what* is allowed to cross the boundary.

### X. Render What You Can Prove

No loading spinner without a timeout. No error state without a retry path. No empty state without
copy. A component that can render "nothing" for any reason must render a deliberate "nothing",
not a blank frame.

### XI. Accessibility Is a Correctness Property

Keyboard navigation, focus order, ARIA roles, and color contrast are not polish. They are either
correct or broken. Every interactive element must be reachable by keyboard and announced by a
screen reader. No `<div onClick>` in new code.

### XII. Measure What Users Feel

Core Web Vitals (LCP, INP, CLS) are the latency budget, not nice-to-haves. Regressions in these
are treated like test failures. Bundle size is tracked per route; new dependencies that add more
than the route's remaining budget require a written justification.

Because this application ships to individual machines rather than a fleet (Principle I), budgets
MUST be enforced by repeatable local and CI measurement against the fixed scenario below, not by
field telemetry. Interaction latency is the governing concern: the dashboard's characteristic
load is a long, filterable list of work items, which degrades on interaction well before it
degrades on paint.

**Fixed measurement scenario**: 1,000 work items across 8 states with 3 gates per state, backed
by two composed provider fakes (Principles III, IV, VI). No live network call may participate in
a budget measurement; results MUST be deterministic and reproducible in CI.

**Budgets**, measured cold against the fixed scenario on a packaged build:

| Metric | Budget |
| --- | --- |
| Cold launch to interactive shell | 1.5 s |
| LCP (renderer) | 800 ms |
| INP, local interactions | 100 ms |
| CLS | 0.05 |
| Total Blocking Time (CI lab proxy) | 150 ms |
| Initial JS, gzipped | 150 KB |
| Each lazily-loaded route, gzipped | 60 KB |
| Total application JS, gzipped | 400 KB |
| Initial CSS, gzipped | 20 KB |

These are localhost-and-disk numbers and are deliberately far below the public Core Web Vitals
"good" thresholds, which assume real networks and mid-tier mobile CPUs. Adopting those public
thresholds here would make this principle unenforceable.

An INP measurement between 100 ms and 200 ms is a warning that MUST be justified in the pull
request; above 200 ms it blocks the merge. Every other budget blocks on exceedance.

Provider-bound actions — a Jira transition, a refresh from the system of record — are bounded by
a remote service and therefore carry no latency budget. They MUST instead present a pending
state within 100 ms and MUST time out within 10 s with a retry path, per Principle X.

The JS budgets govern parse and startup cost, not download cost, since a packaged build ships
its assets on disk. They remain binding because parse time is the dominant contributor to cold
launch, and because the budget is the enforcement mechanism for dependency discipline under
Principle VII.

Changing a budget number is a PATCH amendment; adding or removing a budgeted metric is MINOR.

### XIII. State Lives at the Edge It Is Needed

URL state is URL state. Server state is server state (cache, not store). Form state is local.
Global client state is the last resort. A new entry in a global store requires a written
justification of why URL, server, or local state could not hold it.

This principle governs *client* state. Domain state — the status of a tracked work item — is
governed by Principle V and is never client state; the "server state is cache, not store"
rule here is the same rule Principle VI states for the system of record.

### XIV. Commands Are Discoverable; Local Dev Matches CI

Every repeatable action (dev, build, test, lint, typecheck, e2e) is a single named command listed
in one place. The command a developer runs locally is the same command CI runs. If a new
contributor cannot list every command in 30 seconds, the interface is broken.

### XV. Value Is Realized at the User, Not at Merge

A PR is not done until the change is in the hands of users, observable, and revertible.
"Shipped" means delivered and monitored, not merged. For a locally-run application this means:

- **In the hands of users**: included in a released, installable version, not merely on the main
  branch.
- **Observable**: the running application MUST expose local diagnostics — error detail and the
  performance measurements of Principle XII — that a user can read on their own machine without
  additional tooling. Remote telemetry, if it ever exists, MUST be opt-in and MUST NEVER carry
  credentials, work-item content, or workflow definitions (Principles I and III).
- **Revertible**: a user MUST be able to return to the previous working version by reinstalling
  or pinning it, and any risky behavior MUST sit behind a configuration flag that can be turned
  off without a code change.

Rationale: the principle as commonly written assumes a deployed service with a monitored fleet.
This product has neither, and adopting that framing verbatim would contradict Principle I. The
obligation it encodes — that merging is not delivering, and that undelivered or unobservable
work is not done — applies unchanged.

## Technology and Platform Constraints

- The application MUST be written in TypeScript with `strict` mode enabled. Disabling a strict
  compiler flag requires a constitutional amendment.
- Exported module boundaries — the storage-provider interface, the adapter interface, the gate
  interface, and the workflow schema types — MUST carry explicit type annotations. Use of `any`
  or an unchecked type assertion MUST be justified in the pull request.
- Static types are not runtime validation. All external input — workflow definitions, provider
  responses, user configuration — MUST be validated at the boundary before entering the engine,
  per Principle IX.
- The user interface MUST be built with React. Introducing a second UI framework requires a
  constitutional amendment.
- Interactive UI primitives MUST come from a headless, accessibility-complete component library
  paired with project-owned styles. Adopting a full component framework (one shipping its own
  visual design system) requires a constitutional amendment, because it would exceed the initial
  JS budget of Principle XII and sits in tension with Principle VII.
- The application is distributed as a packaged desktop build that embeds its own runtime. The
  development and build toolchain MUST run on a current Node.js LTS release via the project's
  package manager, per Principle XIV; the packaged artifact MUST NOT impose that requirement on
  the end user, per Principle I.
- Desktop runtime hardening is mandatory: renderer processes MUST run with context isolation
  enabled and direct Node/system API access disabled, MUST NOT load remote code, and MUST
  sanitize all provider-supplied markup before render. This project renders markdown from
  repositories and rich text from issue trackers, so a Principle IX violation in a desktop
  renderer is host code execution, not merely a cross-site scripting defect.
- Business logic MUST live outside React components in framework-agnostic modules, so the
  workflow engine is unit-testable without a DOM.
- Any local cache or index MUST be file-based or embedded, requiring no separate server process,
  per Principle I.
- Dependencies are added deliberately: each new runtime dependency MUST be justified in the pull
  request against a simpler alternative and against the route's remaining bundle budget.

## Development Workflow and Quality Gates

There is no second reviewer on this project, so a gate that depends on someone remembering to
check it is not a gate. Every gate MUST be either machine-enforced or explicitly labelled
self-attested, and every self-attested gate is tracked as automation debt.

**Machine-enforced.** These MUST run from a single `verify` command (Principle XIV), invoked
identically by the maintainer and by CI:

1. **Green suite** — the full unit test suite passes offline.
2. **Typecheck and lint** — TypeScript `strict` passes; lint includes an accessibility ruleset
   (Principle XI) and a rule rejecting hardcoded state, gate, transition, or provider names
   inside engine modules (Principles II, VI).
3. **Zero-config boot test** — the application boots with empty configuration, and a workflow
   declaring an unconfigured provider renders an actionable prompt rather than failing
   (Principle I).
4. **Cache-rebuild test** — deleting the local cache and rebuilding from provider fakes
   reproduces identical state (Principle VI).
5. **Provider-parity test** — the engine suite passes unmodified against every provider fake
   (Principle IV).
6. **Accessibility assertions** — automated a11y checks run against rendered components, and
   every interactive element is keyboard reachable (Principle XI).
7. **Bundle budget** — initial, per-route, and total JS plus initial CSS are within the budgets
   of Principle XII.
8. **Cold-start check** — a clean install, build, and smoke launch of a packaged build succeeds
   (Principle I).
9. **Command parity** — CI invokes only named commands from the single command list, never an
   inline equivalent (Principle XIV).

**Self-attested.** These are not currently machine-checkable and MUST NOT be presented as gates:

10. **Test-first discipline** — that a test preceded its implementation cannot be verified after
    the fact. It is a working practice, not a checkable gate (Principle IV).
11. **Runtime latency budgets** — launch, LCP, INP, CLS, and TBT (Principle XII) stay manual
    until a measurement harness exists. TODO(PERF_HARNESS): build it or drop the metrics.
12. **Design-judgment principles** — VII, VIII, IX, X, and XIII are largely not machine
    checkable. They govern how code is written and are reviewed by the maintainer during
    planning, not enforced at merge.

Any deviation from a principle MUST be recorded in the commit message with its justification and
the simpler alternative that was rejected.

## Governance

This constitution supersedes all other project practices, conventions, and tooling defaults.
Where a style guide, template, or generated artifact conflicts with it, this document wins.

**Amendment procedure**: an amendment is a commit that edits this file, states its rationale in
the commit message, and describes the migration path for anything the change makes
non-compliant. Amendment is expected to happen continuously as the project teaches the
maintainer what these principles actually cost. Code made non-compliant by an adopted amendment
MUST be brought into compliance or explicitly granted a documented, time-bound exception.

**Versioning policy**: this document uses semantic versioning.

- MAJOR — a principle is removed or redefined in a backward-incompatible way, or governance
  rules change incompatibly.
- MINOR — a new principle or section is added, or existing guidance is materially expanded.
- PATCH — clarifications, wording, and typo fixes that do not change obligations.

**Compliance review**: compliance is enforced by automation, not by review. Where a principle
cannot be checked by a machine, this document MUST say so plainly rather than imply a reviewer
will catch it. The principles are re-read at the start of each planning cycle (`/speckit-plan`);
any principle that has become unenforceable, disproportionate to the project's scope, or
routinely waived MUST be amended or removed rather than silently ignored. Runtime development
guidance for agents belongs in `CLAUDE.md`, which MUST remain consistent with this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-09-11 | **Last Amended**: 2026-09-11
