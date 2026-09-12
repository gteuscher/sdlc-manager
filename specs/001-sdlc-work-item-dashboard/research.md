# Phase 0 Research: SDLC Work Item Dashboard

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-11

Every decision below is checked against constitution v2.1.0. Dependency count is itself a
constrained resource under Principle VII and Principle XII, so each addition carries its own
justification.

---

## 1. Desktop shell: Electron

**Decision**: Electron, packaged with `electron-builder`.

**Rationale**: The constitution requires that "the development and build toolchain MUST run on a
current Node.js LTS release via the project's package manager". Tauri's build requires a Rust
toolchain and per-platform system dependencies, which would violate that constraint outright — not
a preference, a rule. Electron's toolchain is Node end to end.

Two further reasons matter for a single maintainer. Electron ships one Chromium everywhere, so an
accessibility assertion or a bundle measurement taken on Windows holds on macOS and Linux; Tauri
uses each platform's system webview (WebView2, WKWebView, WebKitGTK), which means three rendering
targets one person would have to verify. And Electron's main process is Node, so the filesystem,
Jira, and GitHub providers are ordinary Node code rather than Rust commands bridged into
TypeScript.

**Alternatives considered**: *Tauri* — far smaller artifacts and lower memory, genuinely
attractive, but blocked by the Node-only toolchain constraint and costly in per-platform webview
verification. *A local server plus the system browser* — the lightest option, but Principle I's "no
service to deploy" and the hardening requirements are both easier to satisfy in a controlled
renderer than in whatever browser the engineer has, and the user chose a packaged desktop app.

**Note on bundle budgets**: Electron's runtime size does not count against Principle XII, which
budgets *application* JS as a parse-time and dependency-discipline measure. The constitution says
so explicitly. Electron does not consume the 150 KB.

---

## 2. Architecture: the process boundary is the layer boundary

**Decision**: Engine, manifest reader, and all providers run in the Electron **main** process.
React runs in the **renderer**. They communicate only through a typed `contextBridge` surface.

**Rationale**: This is the highest-leverage decision in the plan. Principle IV requires engine
logic to be "unit-testable without rendering a component or touching the network", and Principle
VIII forbids hidden coupling. Putting the engine in a different process from React converts both
from disciplines that erode under deadline into physical facts: `src/core` cannot import React
because React does not exist in its process.

It also satisfies the hardening constraint directly. The renderer runs with `contextIsolation:
true`, `nodeIntegration: false`, and `sandbox: true`, so the untrusted markdown and tracker HTML
this application renders have no path to Node APIs even if a sanitiser is defeated.

**Alternatives considered**: *Everything in the renderer with Node integration enabled* — simpler
wiring, and flatly prohibited by the constitution's hardening rule. *A separate local service
process* — rejected by Principle I ("no separate server process").

---

## 3. Repository layout: one package

**Decision**: A single npm package with internal layers, not a workspace monorepo.

**Rationale**: Principle VII — "reject speculative abstractions… duplication below three
occurrences is cheaper than the wrong abstraction". Nothing consumes these layers as published
packages, and a single maintainer pays the monorepo's wiring cost for no return. The boundary that
matters is enforced by an ESLint `no-restricted-imports` rule failing the build when `src/core` or
`src/providers` imports `electron`, `react`, or anything under `src/renderer`.

**Alternatives considered**: *npm workspaces per layer* — revisit only if `core` is ever published
or consumed by a second application.

---

## 4. Runtime validation: Zod

**Decision**: Zod, used at three boundaries — manifest parsing, provider responses, and IPC
payloads.

**Rationale**: FR-044 requires rejecting an invalid manifest "with a message naming the offending
field and the reason". Zod's `ZodError.issues[].path` produces exactly that structure natively, so
field-level errors are generated rather than hand-written. Principle IX's "validate at the
boundary, not scattered through components" and the constitution's "static types are not runtime
validation" both point at one schema library used consistently.

Most validation happens in the main process, so Zod's weight barely touches the renderer budget.

**Alternatives considered**: *Valibot* — roughly a tenth the bundle size and a real option if the
renderer budget ever tightens, but its error paths are less mature and the size advantage is
mostly irrelevant when validation lives in main. *Hand-written type guards* — cheapest in bytes,
but FR-044's field-level errors would then be written and maintained by hand for every rule in the
manifest contract, which is precisely the work Zod removes.

---

## 5. YAML parsing: `yaml`

**Decision**: The `yaml` package (eemeli), not `js-yaml`.

**Rationale**: `yaml` retains source positions on parsed nodes. A manifest error can therefore say
*which line* of `sdlc.yaml` is wrong, not merely which field path — a material difference when an
SDLC author is debugging a lifecycle they wrote by hand. `js-yaml` discards position information.

---

## 6. Markdown rendering: `react-markdown` + `rehype-sanitize`

**Decision**: `react-markdown` with `remark-gfm` and `rehype-sanitize`, lazily loaded into the item
detail route.

**Rationale**: `react-markdown` renders to React elements. It never produces an HTML string and
never requires `dangerouslySetInnerHTML`, which removes the injection path entirely rather than
filtering it. Given that this application renders markdown from repositories and rich text from
issue trackers inside a desktop renderer, the constitution notes that an escaped injection is host
code execution, not merely XSS — so eliminating the path beats sanitising it, and
`rehype-sanitize` then handles embedded raw HTML as defence in depth.

Lazy loading is mandatory, not an optimisation: the constitution's Principle XII states the
architectural consequence explicitly, and the bundle table in §12 shows why.

**Alternatives considered**: *`marked` + `DOMPurify`* — smaller, but produces an HTML string that
must be injected, reintroducing the exact path this design removes.

---

## 7. UI primitives: Radix UI

**Decision**: Radix UI primitives — Tabs, Dialog, Tooltip — with project-owned CSS.

**Rationale**: The constitution mandates "a headless, accessibility-complete component library
paired with project-owned styles". Story 2's core interaction *is* a tab set, and Radix Tabs
implements the WAI-ARIA tabs pattern with roving focus and arrow-key navigation already correct —
the single largest chunk of Principle XI's obligation, obtained rather than hand-built. Only the
primitives actually used are imported.

**Alternatives considered**: *Headless UI* — comparable, smaller component range. *Hand-built* —
the constitution's scope note on Principle XI already concedes that manual screen-reader
certification is out of scope for one maintainer, which makes hand-rolling focus management the
wrong risk to take.

---

## 8. Reconciliation cache: TanStack Query

**Decision**: TanStack Query over the IPC surface.

**Rationale**: Three requirements describe a query cache almost literally. FR-002 and FR-018 need
"last reconciled" per datum; FR-037 needs stale marking plus retry when a provider fails; FR-010
needs updates without a restart. Principle XIII independently states that server state is "cache,
not store". Writing this by hand means reimplementing staleness, retry, and invalidation, which is
the wrong-abstraction trade Principle VII warns about in the opposite direction — the abstraction
here is not speculative, it is three stated requirements.

Its `queryFn` is any promise, so IPC rather than HTTP is not an obstacle.

**Alternatives considered**: *`useState` + `useEffect` per view* — fewer bytes, and every one of
the three requirements above then becomes bespoke code in components, which Principle VIII's
"explicit dependencies" and Principle IV's testability both suffer for.

---

## 9. Routing: React Router (hash history)

**Decision**: React Router with a hash history.

**Rationale**: FR-015 requires the selected item and state tab to live in application navigation
"so a particular state view can be returned to directly" — that is URL state, and Principle XIII
says URL state belongs in the URL. Hash history avoids the `file://` path handling that trips
browser history inside a packaged Electron app.

---

## 10. Local cache: versioned JSON files

**Decision**: JSON files under the app's user-data directory, in a directory stamped with a cache
schema version.

**Rationale**: The constitution requires any cache to be "file-based or embedded, requiring no
separate server process", and FR-038 requires it to be deletable and rebuildable. At the design
scale — SC-008 names 200+ items across 3+ repositories — JSON read into memory is entirely
adequate, and it is the simplest thing that satisfies the requirement, which is what Principle VII
asks for. Deleting the directory is a valid recovery path, and a test asserts that a rebuild
reproduces identical state.

A version stamp means an incompatible cache is discarded and rebuilt rather than misread.

**Alternatives considered**: *SQLite via `better-sqlite3`* — a native module, so packaging gains
per-platform rebuild complexity for one maintainer. Revisit only if item counts reach the low
thousands.

---

## 11. Credentials: Electron `safeStorage`

**Decision**: Electron's built-in `safeStorage` API, encrypting to the OS keychain.

**Rationale**: Principle III requires credentials never be committed and never written to logs or
telemetry. `safeStorage` is part of Electron — zero additional dependencies, no native module to
rebuild — and delegates to DPAPI on Windows, Keychain on macOS, and libsecret on Linux. Ciphertext
is all that reaches disk. The secrets module is the only place that touches credentials, and no
credential ever crosses the IPC surface into the renderer.

**Alternatives considered**: *`keytar`* — a native dependency, now deprecated. *A plaintext config
file* — non-compliant.

---

## 12. Bundle budget projection

Against Principle XII's 150 KB gzip initial-JS budget:

| Dependency | Initial route | Lazy (detail route) |
|---|---:|---:|
| react + react-dom | ~45 KB | — |
| react-router | ~10 KB | — |
| @tanstack/react-query | ~13 KB | — |
| Radix (tabs, dialog, tooltip) | ~15 KB | — |
| zod (renderer share) | ~10 KB | — |
| Application code | remainder | — |
| react-markdown + remark-gfm + rehype-sanitize | — | ~40 KB |
| **Projected total** | **~93 KB + app code** | **~40 KB** |

Initial sits comfortably under 150 KB; the detail route sits under the 60 KB lazy-route budget.
`size-limit` enforces both in the verify command, so the projection is checked rather than trusted.

---

## 13. Testing stack

**Decision**: Vitest for unit and component tests, React Testing Library, `vitest-axe` for
accessibility assertions, Playwright for the packaged-build cold-launch smoke test.

**Rationale**: Vitest shares the Vite config the renderer already needs, and runs `src/core`
without any DOM environment, which is the concrete form of Principle IV. React Testing Library
tests through rendered output and user interaction, matching Principle IV's ban on reaching into
component internals. `vitest-axe` turns Principle XI's gate 6 into assertions. Playwright drives
gate 8 — a clean install, build, and launch of the actual packaged artifact.

No test performs a live network call; the provider fakes required by Principle III are what the
parity suite runs against.

---

## 14. Live updates: watch locally, poll remotely

**Decision**: `chokidar` watching filesystem-backed sources in the main process; interval polling
for remote providers, plus explicit refresh. Both push invalidations to the renderer over IPC.

**Rationale**: FR-010 requires updates without a restart. The spec's assumption already states
that "sub-second propagation from a remote tracker is not expected", so polling is sufficient and
avoids webhooks — which would require an inbound network path, violating Principle I. `chokidar`
earns its place by normalising the platform differences in `fs.watch` that would otherwise be
hand-handled for Windows, macOS, and Linux.

---

## 15. Advisory console (Story 5, P4)

**Decision**: An `AssistantProvider` behind the same adapter discipline as every other provider,
with no tool access. Unconfigured means the console reports itself unavailable and the rest of the
tab renders (FR-030).

**Rationale**: FR-031a limits v1.0 to answering questions about the state in view. That is a
request/response call with assembled context, not an agent session, so it needs no agent runtime.
Treating it as a provider means Principle I's zero-credential start holds for free, and the Planned
Direction constraint — that transcripts persist in a form a later session-based console can
continue — is satisfied by storing transcripts as ordered message records keyed by item and state
rather than as rendered text.

**Sequencing note**: this is the last slice. Stories 1–4 are a complete product without it.

---

## 16. Resolutions to open questions in the manifest contract

**Q1 — Where does a `manual` gate's result live in a read-only v1.0?**

*Decision*: `evidence` becomes **required** for `kind: manual`, naming a provider-readable location
where the decision is recorded. A manual gate with no evidence locator is a manifest validation
error. Where the decision has not been recorded, the gate is `not_evaluated` and the state reports
that it is awaiting a decision, naming the tool where that decision is made (FR-034a).

*Rationale*: v1.0 cannot record a decision itself without violating FR-034. The alternative —
storing the decision in our local cache — would make the cache authoritative for something no
system of record holds, breaking Principle VI's "no competing authoritative store". Requiring the
lifecycle to say where its own decisions live is the honest constraint.

**Q2 — Per-item versus per-project granularity.**

*Decision*: Granularity is whatever `items.discover` yields: one match is one work item. An
optional `items.unit` string (default `"item"`) lets a lifecycle label it — `"ticket"`, `"game"`,
`"story"` — so the interface can use the engineer's own noun. No structural change.

*Rationale*: The Gamesmith worked example (one game per item) and the Acme example (one ticket per
item) both already fit; the gap was only that nothing said so. Asserting it in the contract costs a
sentence. The display noun is a small, non-speculative addition that avoids the interface calling
a game "an item".

**Q3 — Machine-readable schema.**

*Decision*: The Zod schema in `src/core/manifest` is the executable form of the contract's
validation rules, and the contract document is normative prose describing it. The schema generates
FR-044's field-level errors directly.

*Rationale*: Two hand-maintained copies of the same rules drift. One source that produces the
errors is the version that cannot lie.

---

## 17. Dependency ledger

Eight runtime dependencies, as required by Principle VII's justification rule:

| Dependency | Justified by |
|---|---|
| electron | Packaged desktop delivery; the process boundary the architecture rests on |
| react, react-dom | Constitution mandate |
| react-router | FR-015 URL state |
| @tanstack/react-query | FR-002, FR-010, FR-018, FR-037 |
| @radix-ui/* | Principle XI; constitution's headless-primitives mandate |
| zod | FR-044, FR-048, Principle IX |
| yaml | Manifest parsing with source positions for author-facing errors |
| react-markdown (+ remark-gfm, rehype-sanitize) | FR-017 markdown artifacts, rendered without an injection path |
| chokidar | FR-010, cross-platform file watching |

Development-only: vitest, @testing-library/react, vitest-axe, playwright, size-limit, eslint (with
`jsx-a11y` and `no-restricted-imports`), electron-builder, vite, typescript.
