# Implementation Plan: SDLC Work Item Dashboard

**Branch**: `001-sdlc-work-item-dashboard` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-sdlc-work-item-dashboard/spec.md`

## Summary

A packaged desktop dashboard that reads agentic SDLC lifecycles from the agent packages that
execute them, and shows an engineer every work item in flight, which state each occupies, and
which ones are waiting on a human. v1.0 observes only — it never writes to a system of record.

The technical approach turns Electron's process boundary into the architectural boundary the
constitution already demands. The workflow engine, the manifest reader, and every provider live in
the main process, where they are plain TypeScript with no access to React and no DOM; the renderer
is React and can reach them only through a narrow, typed, validated IPC surface. Principle IV's
"unit-testable without rendering a component" stops being a discipline and becomes a fact about
where the code runs — the engine *cannot* import React, because React is not in its process.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` mode. Node.js 22 LTS for the build and main process.

**Primary Dependencies**: Electron (desktop shell), React 19 + React Router (renderer), TanStack
Query (reconciliation cache), Radix UI primitives (headless, accessible), Zod (runtime validation
at every boundary), `yaml` (manifest parsing with source positions), react-markdown + rehype-
sanitize (artifact rendering, lazy-loaded). Justifications in [research.md](research.md).

**Storage**: No database. Systems of record are external (filesystem, Jira, GitHub) per Principle
VI. Local state is a versioned JSON cache under the app's user-data directory, deletable and
rebuildable. Credentials go to Electron `safeStorage`, never to disk in plaintext and never to
logs.

**Testing**: Vitest (unit + component), React Testing Library, `vitest-axe` (accessibility
assertions), Playwright (packaged-build smoke launch). All offline; no test touches a live network.

**Target Platform**: Packaged desktop application for Windows, macOS, and Linux. Windows is the
primary development platform.

**Project Type**: Desktop application — a single package with an enforced internal layer boundary,
not a monorepo.

**Performance Goals**: Bundle budgets only, per Principle XII: initial JS ≤ 150 KB gzip, each lazy
route ≤ 60 KB, total ≤ 400 KB, initial CSS ≤ 20 KB. Runtime latency is deliberately unbudgeted.

**Constraints**: Starts with zero credentials configured. Fully functional offline for
filesystem-backed lifecycles. Read-only against every system of record. Renderer runs sandboxed
with context isolation on and no direct Node access.

**Scale/Scope**: One engineer's own work. Design target of 200+ active items across 3+
repositories (SC-008); a few thousand items is the point at which the JSON cache would need
revisiting.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution v2.1.0.

| Principle | Status | How this design satisfies it |
|---|---|---|
| I. Local-First Operation | PASS | No service to deploy. Packaged build embeds its own runtime; the end user installs no Node. Starts with zero credentials; a workflow needing an unconfigured provider prompts by name. Filesystem-backed lifecycles work with no network. |
| II. Workflows Are Data | PASS | Every state, gate, and artifact comes from `sdlc.yaml`. Nothing is inferred from skill prose. Enforced by a lint rule forbidding lifecycle vocabulary literals in `src/core` and `src/renderer`. |
| III. Adapters | PASS | One `Provider` contract; Jira, GitHub, and filesystem implement it; each ships a fake. No vendor SDK — plain `fetch` behind the adapter. Credentials from `safeStorage`, never logged. |
| IV. Fully Testable | PASS | `src/core` is pure TypeScript importable by a bare Vitest run. Provider-parity suite runs the engine against every fake unmodified. |
| V. Explicit State | PASS | State derived from the system of record, never from component memory. Transition records written locally; write-back stays off. |
| VI. Storage Follows the SDLC | PASS | Providers are declared by the manifest. The JSON cache is non-authoritative, deletable, rebuildable — asserted by a test. |
| VII. Optimize for Deletion | PASS | Single package, no monorepo. Eight runtime dependencies, each justified in research.md. The four mandated interfaces are the only abstractions. |
| VIII. Explicit Dependencies | PASS | No module-level mutable state; the main-process composition root wires providers explicitly. Lint bans import-time side effects. |
| IX. Network Is the Boundary | PASS | Zod validates every provider response and every IPC payload. Markdown renders to React elements, never `dangerouslySetInnerHTML`. |
| X. Render What You Can Prove | PASS | Query layer gives every fetch a timeout and a retry path; empty and error states are required by component tests. |
| XI. Accessibility | PASS | Radix primitives supply roles, focus order, and keyboard behaviour. `jsx-a11y` lint plus `vitest-axe` assertions in the verify command. |
| XII. Dependency Weight Budget | PASS | Projected initial JS ≈ 83–97 KB gzip against a 150 KB budget; markdown lazy-loaded into the detail route. `size-limit` enforces it. |
| XIII. State at the Edge | PASS | Selected item and state tab are URL state (satisfying FR-015). Provider data is a query cache, not a store. No global client store in v1.0. |
| XIV. Discoverable Commands | PASS | One `npm run verify` runs the nine machine-enforced gates; any automation invokes that same command. |

**Technology constraints**: TypeScript strict ✓ · React ✓ · headless UI primitives ✓ · packaged
desktop embedding its own runtime ✓ · renderer hardening (context isolation on, Node access off, no
remote code, sanitised markup) ✓ · file-based cache with no server process ✓.

**Result: PASS, no violations.** Complexity Tracking is therefore empty and has been removed.

### Post-design re-check (after Phase 1)

Re-evaluated against the Phase 1 artifacts. Still PASS, and the design strengthened three
principles from conventions into structural facts:

- **Principle IV** — the engine runs in a different process from React, so it *cannot* import it.
- **FR-034 (read-only)** — neither the `Provider` interface nor the IPC surface exposes a write
  method. Read-only is the absence of a capability, not restraint in its use.
- **Principle VI** — `tests/unit/cache.rebuild.test.ts` asserts that wiping the cache reproduces
  identical state, so "no competing authoritative store" is verified rather than asserted.

One judgement recorded rather than hidden: **TanStack Query is an abstraction Principle VII would
normally challenge.** It earns its place because FR-002, FR-010, FR-018, and FR-037 each describe a
piece of a query cache, and hand-rolling staleness, retry, and invalidation across three views
would be more code than the dependency. Justification is in [research.md](research.md) §8; if those
requirements were dropped, so should this dependency be.

No entry is required in Complexity Tracking, which is for violations, and this is not one.

## Project Structure

### Documentation (this feature)

```text
specs/001-sdlc-work-item-dashboard/
├── spec.md
├── plan.md                       # This file
├── research.md                   # Phase 0 output
├── data-model.md                 # Phase 1 output
├── quickstart.md                 # Phase 1 output
├── contracts/
│   ├── sdlc-manifest.md          # The lifecycle declaration an SDLC package carries
│   ├── provider-interface.md     # What an adapter must implement, and its fake
│   └── ipc-surface.md            # The typed bridge between main and renderer
├── checklists/
│   └── requirements.md
└── tasks.md                      # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── core/                      # Pure TypeScript. No Electron, no React, no Node built-ins.
│   ├── model/                 # Entity types (data-model.md)
│   ├── manifest/              # Zod schema, parser, validator with field-level errors
│   └── engine/                # State resolution, gate evaluation, attention derivation
├── providers/                 # Principle III
│   ├── contract.ts            # The Provider interface
│   ├── filesystem/
│   ├── jira/
│   ├── github/
│   └── fakes/                 # One fake per provider; the parity suite runs against these
├── main/                      # Electron main process
│   ├── discovery/             # Finding SDLC packages and reading their manifests
│   ├── registry/              # Registered repositories and their package association
│   ├── cache/                 # Versioned, rebuildable JSON cache
│   ├── reconcile/             # File watching and remote polling
│   ├── secrets/               # safeStorage wrapper
│   └── ipc/                   # Handlers implementing contracts/ipc-surface.md
├── preload/                   # contextBridge — the only path between the processes
└── renderer/                  # React
    ├── routes/                # items list · item detail · repositories
    ├── components/
    └── query/                 # TanStack Query wiring over the IPC surface

tests/
├── unit/                      # core, providers, main
├── component/                 # renderer, including accessibility assertions
├── parity/                    # the engine suite, run against every provider fake
└── smoke/                     # packaged-build cold launch
```

**Structure Decision**: A single package with the layering above, not a monorepo. Principle VII
argues against splitting a project this size into published packages before anything demands it,
and the boundary that actually matters — engine must not depend on UI — is enforced two ways
already: `src/core` runs in a different *process* from `src/renderer`, and an ESLint
`no-restricted-imports` rule fails the build if `src/core` or `src/providers` imports from
`electron`, `react`, or `src/renderer`. That rule is gate 2 of the verify command, so the boundary
is machine-checked rather than a convention.
