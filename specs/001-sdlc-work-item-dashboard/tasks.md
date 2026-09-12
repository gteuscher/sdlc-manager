---

description: "Task list for SDLC Work Item Dashboard implementation"
---

# Tasks: SDLC Work Item Dashboard

**Input**: Design documents from `/specs/001-sdlc-work-item-dashboard/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Test tasks ARE included. They are not optional here — constitution Principle IV
("Fully Testable") is NON-NEGOTIABLE and requires every behavior to be covered by a test, and
quality gates 1 and 3–6 are machine-enforced test suites. Note that Principle IV deliberately
does **not** mandate test-first ordering: writing the test first is recommended and usually
fastest, but it is not a rule, so no task below requires a test to fail before implementation.

**Organization**: Grouped by user story so each can be implemented, tested, and demonstrated
independently.

**Revision 2** (post-`/speckit-analyze`): renumbered after adding fourteen tasks resolving the two
CRITICAL and four HIGH findings — real Jira and GitHub providers with response schemas and tests,
four missing test tasks, scale and package-upgrade coverage, duplicate-registration handling, and
provider-disagreement surfacing. v1.0 ships all three providers (filesystem, Jira, GitHub) by
explicit decision. Total 111 → 125.

**Revision 3** (during implementation): added Phase 6a, six tasks dogfooding Spec Kit itself as an
SDLC package. The fixture lifecycles were written to fit this implementation and so cannot falsify
SC-003; Spec Kit is a lifecycle this repository already runs, authored against the contract rather
than against the code. Total 125 → 131.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US5, mapping to spec.md user stories
- Exact file paths are given in every task

## Path Conventions

Single package, layered by process boundary per [plan.md](plan.md):
`src/core/` · `src/providers/` · `src/main/` · `src/preload/` · `src/renderer/` · `tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, toolchain, and the verify command that enforces the gates.

- [X] T001 Create the directory tree from plan.md §Project Structure: `src/core/{model,manifest,engine}`, `src/providers/{filesystem,jira,github,fakes}`, `src/main/{discovery,registry,cache,reconcile,secrets,ipc}`, `src/preload`, `src/renderer/{routes,components,query}`, `scripts/`, `tests/{unit,component,parity,smoke}`
- [X] T002 Initialize `package.json` with the eight runtime dependencies from research.md §17 (electron, react, react-dom, react-router, @tanstack/react-query, @radix-ui primitives, zod, yaml, react-markdown + remark-gfm + rehype-sanitize, chokidar) and dev dependencies (typescript, vite, vitest, @testing-library/react, vitest-axe, playwright, size-limit, eslint, electron-builder)
- [X] T003 [P] Configure `tsconfig.json` with `strict: true` and path aliases `@core/*`, `@providers/*`, `@main/*`, `@renderer/*`; disabling any strict flag requires a constitutional amendment
- [X] T004 [P] Configure Vite in `vite.config.ts` for the renderer and `electron.vite.config.ts` for main and preload builds
- [X] T005 [P] Configure ESLint in `eslint.config.js` with `jsx-a11y` recommended rules (gate 2, Principle XI)
- [X] T006 [P] Add an ESLint `no-restricted-imports` rule in `eslint.config.js` failing the build when `src/core/**` or `src/providers/**` imports `electron`, `react`, `react-dom`, or `@renderer/*` — this is the machine-checked layer boundary from plan.md §Structure Decision
- [X] T007 [P] Add an ESLint rule in `eslint.config.js` rejecting lifecycle vocabulary string literals (state, gate, transition, or provider names) inside `src/core/engine/**` and `src/renderer/**` (gate 2, Principle II)
- [X] T008 [P] Configure Vitest in `vitest.config.ts` with a node environment for `tests/unit` and `tests/parity`, and a DOM environment for `tests/component`
- [X] T009 [P] Configure `size-limit` in `.size-limit.json` with Principle XII's budgets: initial JS 150 KB gzip, each lazy route 60 KB, total 400 KB, initial CSS 20 KB
- [X] T010 Add the named commands from quickstart.md to `package.json` scripts — `dev`, `build`, `package`, `test`, `typecheck`, `lint`, `size`, `smoke`, every `fixture:*` command, and `verify` composing gates 1–9 (Principle XIV)
- [X] T011 [P] Configure `electron-builder` in `electron-builder.yml` for Windows, macOS, and Linux targets with per-user install (no administrator privileges, Principle I)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The manifest reader, provider contract, all three providers, engine, and process
wiring that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Core model and manifest

- [X] T012 [P] Define declared-family entity types (`SdlcPackage`, `SdlcDefinition`, `State`, `GateDecl`, `ArtifactDecl`, `Transition`, `ProviderDecl`, `Locator`, `Condition`) in `src/core/model/declared.ts` per data-model.md
- [X] T013 [P] Define observed-family entity types (`WorkItem`, `GateResult`, `AttentionSignal`, `Repository`, `TransitionRecord`, `Conversation`, `ProviderHealth`) in `src/core/model/observed.ts`; `GateResult.status` is exactly `'passed' | 'failed' | 'not_evaluated'` — three values, no fourth, and no default to `passed`
- [X] T014 [P] Define the `UNMAPPED` sentinel in `src/core/model/observed.ts` as a distinct value that is neither `null` nor a state id, so an unresolvable state can never be confused with an absent one
- [X] T015 [P] Define the `Result<T>` type in `src/core/model/result.ts` — failures are values carrying a typed reason, never thrown exceptions (provider-interface.md rule 1)
- [X] T016 Implement the manifest Zod schema in `src/core/manifest/schema.ts` covering every field in contracts/sdlc-manifest.md §4, with `evidence` **required** when `kind: manual` (rule 15)
- [X] T017 Implement manifest parsing in `src/core/manifest/parse.ts` using the `yaml` package, retaining source line positions so errors can name a line as well as a field path
- [X] T018 Implement the cross-field validation rules 1–15 from contracts/sdlc-manifest.md §5 in `src/core/manifest/validate.ts`, rejecting with the offending field path and source line, and never partially loading (FR-044)
- [X] T019 Implement validation rule 7 in `src/core/manifest/validate.ts`: every field in `ownership` names **exactly one** provider; two owners is a validation error, never a runtime tie-break (Principle VI, FR-048)
- [X] T020 Implement validation rule 9 in `src/core/manifest/validate.ts`: no raw value appears in `maps` for more than one state; ambiguity is rejected at load, not resolved at display time (FR-048)
- [X] T021 Implement contract-version refusal in `src/core/manifest/parse.ts`: a manifest whose `sdlc:` major version is unsupported is refused, naming the version found, rather than loaded and possibly misread (FR-047)
- [X] T022 [P] Unit-test the manifest schema and all 15 validation rules in `tests/unit/manifest.validate.test.ts`, asserting each violating manifest is rejected and names its offending field (Principle IV: every schema rule has a rejection test)

### Provider contract, fakes, and the three v1.0 providers

- [X] T023 Define the `Provider` interface in `src/providers/contract.ts` exactly as contracts/provider-interface.md §1, with **no write methods** — read-only is the absence of a capability (FR-034)
- [X] T024 [P] Implement the filesystem provider fake in `src/providers/fakes/filesystem.fake.ts`, able to produce on demand: healthy, unreachable, missing artifact, and gate-with-no-recorded-result
- [X] T025 [P] Implement the Jira provider fake in `src/providers/fakes/jira.fake.ts`, adding unauthenticated and rate-limited responses to the branch set above
- [X] T026 [P] Implement the GitHub provider fake in `src/providers/fakes/github.fake.ts` with the same branch set
- [X] T027 [P] Implement the filesystem provider in `src/providers/filesystem/index.ts` — markdown artifacts, file-derived state and ownership, with no network dependency of any kind (FR-036)
- [X] T028 [P] Implement the Jira provider in `src/providers/jira/index.ts` using plain `fetch` and no vendor SDK: item discovery by assignment query, raw status reads, field reads for `kind: field` gates, and tracker artifact content (FR-017, provider-interface.md §4)
- [X] T029 [P] Implement the GitHub provider in `src/providers/github/index.ts` using plain `fetch` and no vendor SDK: check results for `kind: check` gates, issue content, and markdown-artifact discovery where a repository is hosted there (FR-017)
- [X] T030 Implement Zod response schemas for both remote providers in `src/providers/jira/schema.ts` and `src/providers/github/schema.ts`, parsing every response before it leaves the provider so a shape change becomes a typed failure rather than a crash (Principle IX, provider-interface.md rule 3)
- [X] T031 [P] Unit-test the Jira and GitHub providers in `tests/unit/providers.remote.test.ts` against recorded response fixtures: schema rejection, unauthenticated, rate-limited, and unreachable all return typed `Result` failures and **never throw** (provider-interface.md rule 1)
- [X] T032 [P] Test credential isolation in `tests/unit/providers.secrets.test.ts`: no credential appears in any log line, error message, or `Result` failure returned by either remote provider (Principle III)

### Engine

- [X] T033 Implement state resolution in `src/core/engine/resolveState.ts`: map a provider's raw value to a declared state via `State.maps`, yielding `UNMAPPED` with `rawState` retained when no declaration matches (FR-005); never coerce to a nearby state
- [X] T034 Implement gate evaluation in `src/core/engine/evaluateGate.ts` handling all four kinds (`manual`, `artifact`, `check`, `field`) through one uniform path, materialising an absent result as `not_evaluated` rather than omitting it (FR-014)
- [X] T035 Implement state progress derivation in `src/core/engine/progress.ts`, marking each state `completed`, `current`, `blocked`, or `not_reached` from the item's ordinal position and its gate results
- [X] T036 [P] Unit-test state resolution and gate evaluation in `tests/unit/engine.resolve.test.ts`, including that a gate with no result is never reported as passed (SC-005)

### Main process infrastructure

- [X] T037 Implement SDLC package discovery in `src/main/discovery/scan.ts`, scanning agent package locations and treating any directory containing a readable `sdlc.yaml` as an available package (FR-042)
- [X] T038 Implement unsupported-package reporting in `src/main/discovery/scan.ts`: a package with no manifest or an unreadable one is listed with what is missing named, and its lifecycle is **never** inferred from skill prose (FR-041, FR-045)
- [X] T039 [P] Implement the repository registry in `src/main/registry/index.ts`, recording each repository's associated package id and version (FR-043)
- [X] T040 [P] Implement the versioned JSON cache in `src/main/cache/index.ts` at `<userData>/cache/v1/` per data-model.md §Cache, discarding and rebuilding an unrecognised version rather than misreading it
- [X] T041 [P] Implement the `safeStorage` credential wrapper in `src/main/secrets/index.ts`; it is the only module that touches credentials, and no credential is ever logged or returned across IPC (Principle III)
- [X] T042 Implement the composition root in `src/main/index.ts`, wiring all three providers explicitly with no module-level mutable state and no import-time side effects (Principle VIII)
- [X] T043 Configure the `BrowserWindow` in `src/main/window.ts` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a CSP forbidding remote code (constitution desktop hardening constraint)

### IPC and renderer shell

- [X] T044 Implement the `contextBridge` surface in `src/preload/index.ts` exposing exactly the methods in contracts/ipc-surface.md §1 and nothing else — this file is the renderer's complete privilege set
- [X] T045 Implement Zod validation of IPC payloads in **both** directions in `src/main/ipc/validate.ts`; the renderer is an untrusted producer to main, and main's replies carry provider data that was itself untrusted (ipc-surface.md rule 2)
- [X] T046 Implement change-event emission in `src/main/ipc/events.ts` as **invalidations, not payloads** — events name what changed and the renderer re-reads, so it never gains a second source of truth (ipc-surface.md §3)
- [X] T047 [P] Create the React application shell in `src/renderer/main.tsx` with `HashRouter` and the three routes: items list, item detail, repositories
- [X] T048 [P] Configure the TanStack Query client in `src/renderer/query/client.ts` over the IPC surface, with staleness and retry mapped to FR-037
- [X] T049 [P] Implement a fixture generator in `scripts/fixture.ts` creating a filesystem-backed repository with six states, gates of each kind, and items seeded across states including one awaiting input, one with a failed gate, and one with an unevaluated gate; accept an item-count parameter so scale fixtures can be generated for SC-008 (quickstart.md §Fixture repository)

### Foundational gate tests

- [X] T050 [P] Write the zero-config boot test in `tests/unit/boot.zero-config.test.ts`: the application boots with empty configuration and a workflow declaring an unconfigured provider renders an actionable prompt naming it, rather than failing (gate 3, FR-035)
- [X] T051 [P] Write the cache rebuild test in `tests/unit/cache.rebuild.test.ts`: deleting the cache and rebuilding from provider fakes reproduces identical `WorkItem` state (gate 4, FR-038, SC-009)
- [X] T052 Write the provider-parity harness in `tests/parity/harness.ts` running the engine suite against every provider fake **unmodified**; document in the file header that a test passing for one fake and failing for another indicates provider knowledge has leaked into the engine, not a provider bug (gate 5, Principle IV)
- [X] T053 [P] Write the command-parity test in `tests/unit/commands.parity.test.ts` asserting any automation config invokes only named scripts from `package.json`, never an inline equivalent (gate 9, Principle XIV)
- [X] T054 [P] Write the renderer hardening test in `tests/unit/window.hardening.test.ts` asserting the `BrowserWindow` configuration in `src/main/window.ts` has `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a CSP forbidding remote code — these are silently loosened during debugging and never restored, so they need an assertion rather than a convention
- [X] T055 [P] Write the credential-handling test in `tests/unit/secrets.test.ts`: `safeStorage` ciphertext is all that reaches disk, no credential crosses the IPC surface in any direction, and no credential appears in a log line (Principle III, ipc-surface.md rule 3)

**Checkpoint**: Manifest reading, all three providers, engine, process wiring, and the gate tests
are in place. User stories can begin.

---

## Phase 3: User Story 1 — See every active item and what needs me (Priority: P1) 🎯 MVP

**Goal**: One list of every active work item across all registered repositories, with items needing
human action visibly marked and ordered first.

**Independent Test**: Register two repositories using different SDLC definitions, seed items in
various states including one awaiting input, and confirm the list shows every active item with the
correct state and only the blocked items marked.

### Tests for User Story 1

- [X] T056 [P] [US1] Test attention derivation in `tests/unit/engine.attention.test.ts`: `input_needed` and `gate_failed` are distinguished, and derivation is pure so it survives a restart and a cache wipe (FR-006, FR-007)
- [X] T057 [P] [US1] Test multi-lifecycle aggregation in `tests/unit/items.aggregate.test.ts`: items from two repositories with different SDLC definitions resolve against their own state vocabularies in one list (FR-001, SC-003)
- [X] T058 [P] [US1] Test ownership scoping in `tests/unit/items.ownership.test.ts`: tracker-assigned and markdown-artifact-present items both qualify, and an item qualifying under both providers is listed **once, not once per provider** (FR-001a, SC-012)
- [X] T059 [P] [US1] Test reconciliation in `tests/unit/reconcile.test.ts`: a change to a watched file and a change surfaced by a poll tick each produce an invalidation event and an updated item state **without a restart** (FR-010)
- [X] T060 [P] [US1] Component-test the item list in `tests/component/ItemList.test.tsx` including the empty state, the attention ordering, and `vitest-axe` assertions (gate 6, FR-008)

### Implementation for User Story 1

- [X] T061 [US1] Implement attention derivation in `src/core/engine/attention.ts` as a pure function of `(State.awaitsHuman, GateDecl.awaitsHuman, GateResult.status)`, producing `kind: 'input_needed' | 'gate_failed'` with an actionable reason (FR-006)
- [X] T062 [US1] Implement item discovery orchestration in `src/main/reconcile/discover.ts`, running each manifest `items.discover` rule through its provider and de-duplicating by correlation key (FR-001a)
- [X] T063 [US1] Implement reconciliation in `src/main/reconcile/index.ts` with `chokidar` watching filesystem sources and interval polling for remote providers, emitting invalidation events (FR-010)
- [X] T064 [US1] Implement the `listItems` IPC handler in `src/main/ipc/items.ts` returning `WorkItemSummary[]` with identifier, title, SDLC name, current state, and `reconciledAt` (FR-002)
- [X] T065 [US1] Implement the items list route in `src/renderer/routes/Items.tsx` with attention-first ordering (FR-008)
- [X] T066 [P] [US1] Implement the attention marker component in `src/renderer/components/AttentionBadge.tsx` rendering `input_needed` and `gate_failed` as **visibly distinct** markers (FR-006)
- [X] T067 [P] [US1] Implement the attention count in `src/renderer/components/AttentionCount.tsx` (FR-009)
- [X] T068 [P] [US1] Implement filtering by repository, SDLC, and state, plus search by identifier or title, in `src/renderer/components/ItemFilters.tsx` (FR-004)
- [X] T069 [P] [US1] Implement the unmapped-item row treatment in `src/renderer/components/ItemRow.tsx`, showing the raw recorded value for items carrying `UNMAPPED` (FR-005)
- [X] T070 [US1] Implement the empty state in `src/renderer/routes/Items.tsx` offering repository registration, with copy — never a blank frame (Principle X)
- [X] T071 [US1] Implement provider-failure handling in `src/renderer/routes/Items.tsx`: items from healthy providers stay visible and correct while items from a failing provider are marked stale with a retry (FR-037, SC-007)
- [X] T072 [US1] Implement provider-disagreement surfacing in `src/main/reconcile/discover.ts` and `src/renderer/components/ItemRow.tsx`: when two providers report different values for one item, the provider the manifest's `ownership` block declares owner wins, **and the disagreement is shown rather than hidden** (spec §Edge Cases)

**Checkpoint**: US1 is fully functional and independently demonstrable. This is the MVP.

---

## Phase 4: User Story 2 — Follow one item through its SDLC states (Priority: P2)

**Goal**: A detail view presenting the lifecycle's states as tabs, opened on the current state, with
completion markers and gate results.

**Independent Test**: Open an item that has completed three of six states and confirm the view opens
on the fourth, marks the first three complete, shows the last two as not reached, and renders gate
results for each completed state.

### Tests for User Story 2

- [X] T073 [P] [US2] Test progress derivation in `tests/unit/engine.progress.test.ts` across completed, current, blocked, and not-reached states
- [X] T074 [P] [US2] Test transition records in `tests/unit/transitions.test.ts`: each observed transition is appended with `gateResultsAtTransition` **snapshotted rather than referenced**, so the record still explains why after the live results change (FR-032, Planned Direction)
- [X] T075 [P] [US2] Component-test the state tabs in `tests/component/StateTabs.test.tsx`, asserting tabs render in lifecycle order for an SDLC the test invents, that the current state opens by default (FR-012), and `vitest-axe` plus keyboard arrow navigation pass (FR-011, FR-016, gate 6)
- [X] T076 [P] [US2] Component-test gate display in `tests/component/GateList.test.tsx` asserting `not_evaluated` renders as a **distinct third state**, never as passed (FR-014, SC-005)

### Implementation for User Story 2

- [X] T077 [US2] Implement the `getItem` IPC handler in `src/main/ipc/items.ts` returning `WorkItemDetail` with per-state progress and gate results
- [X] T078 [US2] Implement transition records in `src/main/cache/transitions.ts` as append-only JSONL, snapshotting `gateResultsAtTransition` so the record explains *why* and carries what a future write-back would need (FR-032, Planned Direction)
- [X] T079 [US2] Implement the item detail route in `src/renderer/routes/ItemDetail.tsx` using Radix Tabs, opening on the state the item currently occupies (FR-012), driven entirely by the loaded definition with no knowledge of any state name (FR-011, FR-016, SC-010)
- [X] T080 [US2] Wire selected item and state tab into URL state in `src/renderer/routes/ItemDetail.tsx` so a state view can be returned to directly (FR-015, Principle XIII)
- [X] T081 [P] [US2] Implement the state status marker in `src/renderer/components/StateMarker.tsx` for completed, current, blocked, and not reached (FR-013)
- [X] T082 [P] [US2] Implement the gate result list in `src/renderer/components/GateList.tsx` rendering all three statuses with the recorded reason (FR-014, Principle V)
- [X] T083 [US2] Implement the read-only affordance in `src/renderer/components/StateActions.tsx`: where an action is needed, name **where it is performed** rather than rendering a control that does nothing (FR-034a)
- [X] T084 [US2] Implement unmapped and upgraded-package handling in `src/renderer/routes/ItemDetail.tsx`: an item whose state no longer exists reports its raw value and is neither dropped nor reassigned (FR-046)

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Read the artifacts behind each state (Priority: P2)

**Goal**: Markdown, tracker content, and test results rendered in each state tab with provenance and
reconciliation time.

**Independent Test**: Configure a state with one artifact of each kind, confirm all three render with
correct provenance, and confirm an unreadable artifact reports the failure in place while the rest of
the tab still renders.

### Tests for User Story 3

- [X] T085 [P] [US3] Test artifact resolution in `tests/unit/artifacts.resolve.test.ts` including `{item.<field>}` locator templating against fields declared in `items.identity`
- [X] T086 [P] [US3] Component-test artifact rendering in `tests/component/ArtifactPanel.test.tsx` for all three kinds, plus the missing-artifact case, with `vitest-axe` assertions (gate 6)
- [X] T087 [P] [US3] Test markdown safety in `tests/component/Markdown.safety.test.tsx`: active content embedded in provider-supplied markdown is not executed and no raw HTML string is injected (FR-020, Principle IX)

### Implementation for User Story 3

- [X] T088 [US3] Implement artifact reading per kind in `src/main/ipc/artifacts.ts` — `markdown`, `tracker`, `test-results` — returning content plus provenance and `reconciledAt`, never HTML for injection (ipc-surface.md rule 6)
- [X] T089 [P] [US3] Implement the markdown renderer in `src/renderer/components/MarkdownArtifact.tsx` with `react-markdown`, `remark-gfm`, and `rehype-sanitize`, rendering to React elements and never `dangerouslySetInnerHTML`
- [X] T090 [US3] Lazy-load the markdown renderer into the item detail route via `React.lazy` in `src/renderer/routes/ItemDetail.tsx` — required by the 150 KB initial budget, not an optimisation (Principle XII)
- [X] T091 [P] [US3] Implement the test-results artifact view in `src/renderer/components/TestResultsArtifact.tsx` showing the run outcome with passing distinguishable from failing (FR-017)
- [X] T092 [P] [US3] Implement the tracker artifact view in `src/renderer/components/TrackerArtifact.tsx` attributed to the tracker
- [X] T093 [P] [US3] Implement the artifact provenance header in `src/renderer/components/ArtifactProvenance.tsx` showing source and last-reconciled time (FR-018)
- [X] T094 [US3] Implement in-place artifact failure reporting in `src/renderer/components/ArtifactPanel.tsx`, naming what failed while the rest of the state still renders (FR-019)
- [X] T095 [US3] Implement large-artifact handling in `src/renderer/components/ArtifactPanel.tsx` so a very long document or a run with thousands of cases does not block the rest of the view (FR-021)

**Checkpoint**: US1–US3 deliver the complete tracking experience.

---

## Phase 6: User Story 4 — Manage the repositories using an SDLC (Priority: P3)

**Goal**: A view listing registered repositories grouped by SDLC, with per-repository configuration
including declared gates.

**Independent Test**: Register a repository with a valid configuration and a second with a malformed
one; confirm the first is grouped under its SDLC with editable configuration and the second reports a
validation error naming the offending field.

### Tests for User Story 4

- [X] T096 [P] [US4] Test repository configuration validation in `tests/unit/registry.config.test.ts`: an invalid value is rejected naming field and reason, and the prior configuration is retained (FR-025)
- [X] T097 [P] [US4] Component-test the repositories view in `tests/component/Repositories.test.tsx` including SDLC grouping, package version display, and `vitest-axe` assertions
- [X] T098 [P] [US4] Test unsupported-package refusal in `tests/unit/discovery.unsupported.test.ts`: a package with no manifest cannot be associated with a repository and names what is missing (FR-045)
- [X] T099 [P] [US4] Test degenerate registrations in `tests/unit/registry.degenerate.test.ts`: registering the same repository twice is rejected or coalesced rather than duplicated, and a repository whose path no longer exists is reported as unavailable rather than crashing the view (spec §Edge Cases)
- [X] T100 [P] [US4] Test package upgrade adding a state in `tests/unit/discovery.upgrade.test.ts`: upgrading a package to a version declaring an **additional** state causes that state to appear, with no change to application code (SC-013)

### Implementation for User Story 4

- [X] T101 [US4] Implement `registerRepository`, `updateRepositoryConfig`, and `removeRepository` IPC handlers in `src/main/ipc/repositories.ts`; these write **local application configuration only**, never a system of record (FR-023, ipc-surface.md rule 1)
- [X] T102 [US4] Implement degenerate-registration handling in `src/main/registry/index.ts`: reject or coalesce a duplicate registration, and mark a repository whose path has disappeared as unavailable while leaving the rest of the registry usable (spec §Edge Cases)
- [X] T103 [US4] Implement the repositories route in `src/renderer/routes/Repositories.tsx` grouping by SDLC definition and showing each repository's package and version (FR-022, FR-043)
- [X] T104 [US4] Implement the configuration form in `src/renderer/components/RepoConfigForm.tsx`, generated from the package's `repoConfig` declarations including configurable gates (FR-024)
- [X] T105 [US4] Implement field-level validation error display in `src/renderer/components/RepoConfigForm.tsx` from the Zod issue paths, naming field and reason (FR-025)
- [X] T106 [P] [US4] Implement provider health and credential status in `src/renderer/components/ProviderStatus.tsx`, reporting which providers a repository requires and which are unconfigured (FR-026)
- [X] T107 [P] [US4] Implement the `setCredential` flow in `src/renderer/components/CredentialForm.tsx` — passes a secret in, never reads one back (ipc-surface.md rule 3)
- [X] T108 [US4] Implement unsupported-package presentation in `src/renderer/routes/Repositories.tsx`, offering such packages as unsupported with the missing manifest named and refusing association (FR-045)

**Checkpoint**: US1–US4 are a complete product. Story 5 is genuinely optional.

---

## Phase 6a: Dogfood — Spec Kit as an SDLC package

**Purpose**: Prove SC-003 against a lifecycle neither this project's authors nor its fixture
generator invented. The fixture lifecycles are ours, so they cannot falsify "generic over
lifecycles" — they were written to fit. Spec Kit is a real lifecycle already running in this
repository, with ordered states, declared artifacts, and a genuinely reviewer-owned gate.

It is also the case FR-041 exists for: Spec Kit encodes its stages in **skill prose**, so today it
must be reported as unsupported. Writing the manifest is the work the spec says an existing harness
has to do, performed on ourselves.

**Independent Test**: Register this repository against the Spec Kit package and confirm
`specs/001-sdlc-work-item-dashboard/` appears as one work item in the state its artifacts place it
in, with the requirements checklist showing as a manual gate.

- [X] T126 Confirm the unsupported path first: with no manifest present, `scanPackages` reports the Spec Kit package as unsupported naming the missing `sdlc.yaml`, and no state is inferred from `.claude/skills/speckit-*/SKILL.md` prose (FR-041, FR-045, SC-014)
- [X] T127 Author `.specify/sdlc.yaml` declaring the Spec Kit lifecycle: ordered states `specify`, `clarify`, `plan`, `tasks`, `analyze`, `implement`; a `filesystem` provider owning every field; items discovered by the glob `specs/*/spec.md` with `items.unit: feature`; per-state markdown artifacts (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `tasks.md`)
- [X] T128 Declare the checklist gate in `.specify/sdlc.yaml`: `checklists/requirements.md` as `kind: manual` with an `evidence` locator, since it is reviewer-owned and v1.0 cannot record the decision itself (rule 15, research.md §16 Q1)
- [X] T129 [P] Validate the manifest in `tests/unit/dogfood.speckit.test.ts`: `.specify/sdlc.yaml` passes `readManifest`, and every state, gate, and artifact it declares resolves against this repository's actual files (SC-014)
- [X] T130 Register this repository against the Spec Kit package and confirm `specs/001-sdlc-work-item-dashboard/` resolves to the expected state with its artifacts rendering, per the Independent Test above
- [X] T131 Add scenario V12 to quickstart.md covering the dogfood registration, and **record in this file any application code change the exercise forced** — a required change is an SC-003 failure and a finding, not a task

**Checkpoint**: a third lifecycle, authored against the contract rather than against the
implementation, renders with no application change.

### T131 finding: what adopting Spec Kit actually cost

**No application code change was required.** SC-003 holds:
`tests/unit/dogfood.speckit.test.ts` asserts that no Spec Kit state id appears as a
string literal anywhere in `src/`, and the assertion passes. The engine resolved a
seven-state lifecycle, four gate kinds, and six markdown artifacts it had never
seen, from a manifest written against the contract document.

Two changes **to the SDLC package and its repository** were required, which is
exactly what spec.md §Assumptions predicts for an existing harness:

1. **`.specify/sdlc.yaml`** — the manifest itself. Expected; this is the work the
   spec says an existing harness must do to become supported.

2. **A `.sdlc-state.json` per feature directory.** This is the real finding. Spec
   Kit records which stage a feature has reached only *implicitly*, in which
   artifacts happen to exist — there is no field anywhere that names the current
   stage. The filesystem provider derives state from a declared JSON field, so
   adopting the contract meant making that stage explicit.

   This is a gap in Spec Kit, not in the dashboard: a lifecycle whose current state
   cannot be read is a lifecycle whose items cannot be placed, and inferring it
   from artifact presence would be exactly the "guessing from what happens to be
   there" that Principle II forbids. Worth noting for any harness adopting this
   contract — **enumerating your states is not enough; something must record which
   one an item is in.**

One contract observation, recorded rather than acted on: the manual gate's
`evidence` locator must point at a provider-readable *field*, so the reviewer
decision for the requirements checklist lives in the state file rather than being
read from the `- [x]` markers in `checklists/requirements.md` itself. Reading a
markdown checkbox would need either a new artifact-shaped gate kind or a provider
that parses checklists. Neither is justified by one case, and the checklist markers
remain the reviewer-owned artifact they always were (see the `/speckit-implement`
note that they are a read-only gate).

---

## Phase 7: User Story 5 — Discuss a state in context (Priority: P4)

**Goal**: An advisory conversation console scoped to each state tab, persisting per state per item.

**Independent Test**: Hold a short conversation in one state tab, navigate away and back, and confirm
the transcript is restored and distinct from other states' transcripts.

### Tests for User Story 5

- [X] T109 [P] [US5] Test conversation scoping and persistence in `tests/unit/conversation.scope.test.ts`: transcripts are keyed by `(itemKey, stateId)` and stored as ordered message records, not rendered text (FR-028, FR-029, Planned Direction)
- [X] T110 [P] [US5] Component-test the console in `tests/component/Console.test.tsx` including the unavailable state and `vitest-axe` assertions (FR-030)

### Implementation for User Story 5

- [X] T111 [US5] Implement the `AssistantProvider` in `src/providers/assistant/index.ts` behind the same `Provider` discipline — absent by default, reporting unavailability rather than failing (research.md §15)
- [X] T112 [US5] Implement conversation persistence in `src/main/cache/conversations.ts` at `<userData>/cache/v1/conversations/<itemKey>/<stateId>.json` as ordered `{role, content, at}` records
- [X] T113 [US5] Implement `askConsole` and `getConversation` IPC handlers in `src/main/ipc/console.ts`, assembling the scoped state, its artifacts, and its gate results as context (FR-031)
- [X] T114 [US5] Implement the console component in `src/renderer/components/Console.tsx` docked within each state tab (FR-027)
- [X] T115 [US5] Enforce the advisory limit in `src/main/ipc/console.ts`: no tool execution and no modification of items, repositories, artifacts, or configuration; a change request is answered by naming where it must be made (FR-031a)
- [X] T116 [US5] Implement the unavailable-console state in `src/renderer/components/Console.tsx` so the rest of the tab renders normally (FR-030)

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T117 [P] Write the packaged-build smoke test in `tests/smoke/launch.spec.ts` with Playwright: clean install, build, package, and launch succeeds (gate 8, FR-035)
- [X] T118 [P] Extend `scripts/fixture.ts` with the `fixture:package --omit-manifest`, `fixture:fail`, `fixture:upgrade --remove-state`, and `fixture:upgrade --add-state` commands used by quickstart.md scenarios V6, V7, and V10 and by SC-013
- [X] T119 Measure SC-008 in `tests/smoke/scale.spec.ts`: generate at least 200 items across at least 3 repositories with `scripts/fixture.ts`, then confirm the item list renders and attention-first ordering is usable (SC-008)
- [ ] T120 Run every quickstart.md validation scenario V1–V11 and record the results, including SC-004's "under 5 minutes without consulting documentation" as an observation
- [ ] T121 Verify scenario V9 explicitly: run V1–V8 against a version-controlled fixture and confirm `git status` reports **no modifications** (SC-011, FR-034)
- [X] T122 [P] Confirm `npm run size` passes against Principle XII's budgets and record the actual initial-JS figure against the ~93 KB projection in research.md §12
- [X] T123 [P] Write `README.md` with the install step and single start command, the command list from quickstart.md, and the zero-credential first-run behaviour (Principle I, Principle XIV)
- [X] T124 [P] Write `CONTRIBUTING.md` documenting the nine machine-enforced gates and the one self-attested item, matching the constitution's Development Workflow section
- [X] T125 Review `src/` against the design-judgment principles VII, VIII, IX, X, and XIII — the constitution's single self-attested gate, reviewed at this checkpoint rather than pretended to be enforced

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Foundational. No dependency on other stories
- **US2 (Phase 4)**: Depends on Foundational. Independently testable; shares the detail route with US3
- **US3 (Phase 5)**: Depends on Foundational. Renders **inside** US2's tabs, so US2 is a practical prerequisite for demonstration even though the artifact logic is independent
- **US4 (Phase 6)**: Depends on Foundational only. The most independent story — could be built first if onboarding mattered more than tracking
- **US5 (Phase 7)**: Depends on Foundational; docks inside US2's tabs
- **Polish (Phase 8)**: Depends on the stories being delivered

### Within Each Story

Model → engine → main-process handler → IPC → renderer. Tests alongside, in whichever order is
fastest — Principle IV requires the coverage, not the sequence.

### Parallel Opportunities

- Setup: T003–T009 and T011 all parallel
- Foundational: T012–T015 parallel; fakes T024–T026 parallel; the three providers T027–T029 parallel; gate tests T050, T051, T053, T054, T055 parallel
- US1: T056–T060 parallel; T066–T069 parallel
- US2: T073–T076 parallel; T081, T082 parallel
- US3: T085–T087 parallel; T089, T091, T092, T093 parallel — four independent artifact components
- US4: T096–T100 parallel; T106, T107 parallel
- Polish: T117, T118, T122, T123, T124 parallel

---

## Parallel Example: the three v1.0 providers

```bash
Task: "Implement the filesystem provider in src/providers/filesystem/index.ts"
Task: "Implement the Jira provider in src/providers/jira/index.ts"
Task: "Implement the GitHub provider in src/providers/github/index.ts"
```

## Parallel Example: User Story 1 tests

```bash
Task: "Test attention derivation in tests/unit/engine.attention.test.ts"
Task: "Test multi-lifecycle aggregation in tests/unit/items.aggregate.test.ts"
Task: "Test ownership scoping in tests/unit/items.ownership.test.ts"
Task: "Test reconciliation in tests/unit/reconcile.test.ts"
Task: "Component-test the item list in tests/component/ItemList.test.tsx"
```

---

## Implementation Strategy

### MVP: Phases 1–3

Setup → Foundational → US1. That yields the aggregated item list with attention markers, which is
the product's core claim and is useful on its own. **Stop and validate** with quickstart V1 and V2
before continuing — V2 in particular proves Principle II holds, because a second lifecycle must
work with no application change.

Foundational is unusually large here relative to US1, which is expected: the manifest reader, the
three providers, and the engine are the product. US1 is a thin view over machinery every later
story reuses.

**If you want to reach a running MVP sooner**, T028–T032 (the Jira and GitHub providers and their
tests) can be completed after US1 rather than before it. The filesystem provider alone satisfies
every US1 acceptance scenario, and the fakes keep the parity suite honest in the meantime. This is
a sequencing convenience, not a scope reduction — v1.0 ships all three providers.

### Incremental Delivery

1. Phases 1–2 → foundation
2. + US1 → **MVP**, validate with V1, V2
3. + US2 → per-item journey, validate with V3
4. + US3 → artifacts, validate with V4
5. + US4 → onboarding beyond the first repository, validate with V5, V6
6. + US5 → advisory console, or defer it entirely

### On deferring Story 5

US1–US4 are a coherent, shippable product. Story 5 is P4, is the largest remaining piece, and its
known end state is a supervised agent session that v1.0 deliberately does not build. Splitting it
into its own feature after v1.0 remains a live option, and nothing in Phases 1–6 depends on it.

---

## Notes

- `[P]` means a different file with no dependency on incomplete work
- Every task names its file path and, where a constraint is involved, quotes it rather than leaving
  it to implementation-time discretion
- Commit after each task or logical group; record any principle deviation in the commit message
  with the simpler alternative that was rejected
- Test-first is recommended, not required — Principle IV requires coverage, not ordering
