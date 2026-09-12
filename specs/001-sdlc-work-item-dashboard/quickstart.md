# Quickstart & Validation Guide

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-11

How to run the dashboard and prove it works end to end. Every scenario below runs offline and uses
provider fakes or a fixture repository — none requires a Jira instance or a GitHub token.

---

## Prerequisites

- Node.js 22 LTS and npm
- Nothing else. No database, no Rust toolchain, no credentials, no network.

## Commands

Principle XIV: every repeatable action is one named command, and automation invokes the same ones.

| Command | What it does |
|---|---|
| `npm run dev` | The dashboard in development, with reload |
| `npm run build` | Production build of main, preload, and renderer |
| `npm run package` | The installable desktop artifact |
| `npm test` | Unit, component, and parity suites |
| `npm run typecheck` | TypeScript `strict` |
| `npm run lint` | ESLint, including `jsx-a11y` and the layer-boundary rule |
| `npm run size` | Bundle budgets from Principle XII |
| `npm run smoke` | Cold launch of a packaged build |
| **`npm run verify`** | **All nine machine-enforced gates. This is what CI runs.** |

## First run

```
npm install
npm run dev
```

The application opens with **no repositories registered and no credentials configured**, showing an
empty state that offers to register one. That it opens at all with zero configuration is
Principle I and SC-006 — if it prompts for credentials before showing anything, that is a failure,
not a setup step.

## Fixture repository

```
npm run fixture:create -- ./tmp/demo
```

Creates a repository using a filesystem-backed lifecycle: a markdown system of record, six states,
gates of each kind, and items seeded across states — one awaiting human input, one with a failed
gate, one with a gate never evaluated. No network, so the whole of Stories 1–3 is exercisable
offline.

Register `./tmp/demo` from the repositories view.

---

## Validation scenarios

Each maps to user stories and success criteria in the spec. These are the acceptance walkthroughs;
their automated equivalents live in `tests/`.

### V1 — Every active item, attention first *(Story 1 · SC-001)*

1. Register the fixture repository.
2. Observe the item list.

**Expected**: every active item appears with identifier, title, SDLC name, current state, and last
reconciled time. The awaiting-input item and the failed-gate item sort above the rest, carry
**visibly different** markers, and the attention count matches their number. Identifying what needs
you takes under 10 seconds without opening anything.

### V2 — Two lifecycles in one list *(Story 1 · SC-003)*

1. `npm run fixture:create -- ./tmp/demo2 --sdlc alt` (different states, gates, and state count).
2. Register it too.

**Expected**: both repositories' items appear in one list, each labelled with its own SDLC, each
resolving against its own state vocabulary. **No application change was needed** to support the
second lifecycle — that is Principle II and SC-003, and it is the product's central claim.

### V3 — Following one item through its states *(Story 2 · SC-002)*

1. Open the item sitting in the fourth of six states.

**Expected**: six tabs in lifecycle order, opened on the fourth. The first three are marked
complete, the current one current, the last two not reached. Gate results show passed, failed, and
**not evaluated as a distinct third value** — a gate with no recorded result must never display as
passed (FR-014, SC-005). Selecting another tab changes the URL so the view can be returned to
directly.

### V4 — Artifacts and their provenance *(Story 3)*

1. In a state tab, inspect its artifacts.
2. Delete one of the fixture's markdown files and refresh.

**Expected**: markdown renders with source path and reconciled time; test results render with a
readable outcome. The deleted artifact reports **what is missing and why, in place**, while the
rest of the tab still renders (FR-019).

### V5 — Repositories and configuration *(Story 4)*

1. Open the repositories view.
2. Edit the fixture's configuration and save an invalid value.

**Expected**: repositories grouped by SDLC, each showing its package **and version**. The invalid
save is rejected **naming the offending field and reason**, and the prior configuration is retained
(FR-025).

### V6 — An unsupported package *(FR-045)*

1. `npm run fixture:package -- ./tmp/no-manifest --omit-manifest`

**Expected**: the package is listed as **unsupported with the missing manifest named**, and cannot
be associated with a repository. It must not have its lifecycle guessed from skill prose — that is
Principle II's hard line (FR-041).

### V7 — Degraded providers *(FR-037 · SC-007)*

1. Register a fixture using a fake tracker provider.
2. `npm run fixture:fail -- tracker unreachable`

**Expected**: items from healthy providers stay visible and correctly stated; items from the
failing provider are marked **stale with a retry available**; the failure is reported by name. The
application does not become unusable because one provider is down.

### V8 — The cache is not authoritative *(FR-038 · SC-009)*

1. Note several item states.
2. Quit, delete the whole cache directory, reopen.

**Expected**: identical item states and gate results, rebuilt from the systems of record. This is
the practical proof of Principle VI — if anything differs, the cache was holding something
authoritative.

### V9 — Read-only *(FR-034 · SC-011)*

1. Work through V1–V8 with the fixture repository under version control.
2. `git -C ./tmp/demo status`

**Expected**: **no modifications.** No file changed, no comment posted, nothing written back. The
IPC surface exposes no write capability, so this should be structurally impossible rather than
merely observed — but it is worth observing.

### V10 — A package upgrade mid-flight *(FR-046)*

1. `npm run fixture:upgrade -- ./tmp/demo --remove-state review`

**Expected**: items formerly in `review` are marked **unmapped, retaining their raw value**. They
are neither dropped from the list nor reassigned to an adjacent state.

### V11 — Offline *(FR-036)*

1. Disable networking entirely and reopen with only the filesystem-backed fixture registered.

**Expected**: full function. A filesystem lifecycle has no remote dependency and must not acquire
one.

### V12 — Spec Kit tracking itself *(SC-003 · SC-014 · FR-041)*

1. Register this repository, associating it with the **Spec Kit** package at
   `.specify/`.

**Expected**: each directory under `specs/` appears as one work item — `items.unit`
is `feature`, so the interface calls them features rather than "items". This
feature resolves to **Implement**; the constitution check reads as passed from the
state file; the verification gate reads **not evaluated**, because nothing has
recorded a result for it. Feature `002` sits in **Clarify** and carries an
*awaiting input* marker, because its reviewer decision is deliberately unrecorded.

**Why this scenario is the important one**: the fixture lifecycles were written to
fit this implementation and so cannot falsify SC-003. Spec Kit's manifest was
written against [contracts/sdlc-manifest.md](contracts/sdlc-manifest.md) instead.
Before it existed, Spec Kit encoded its stages only in skill prose, and the
dashboard was required to report it as unsupported — assert that first
(`tests/unit/dogfood.speckit.test.ts`), because a dogfood that skips the
unsupported case is testing the easy half.

---

## Gate coverage

`npm run verify` runs gates 1–9 of the constitution. Gate 10 — the design-judgment principles — is
self-attested by the maintainer at planning time and is not checked here, which the constitution
states plainly rather than implying enforcement that does not exist.

| Gate | Command |
|---|---|
| 1 Green suite | `npm test` |
| 2 Typecheck and lint (incl. boundary + a11y rules) | `npm run typecheck`, `npm run lint` |
| 3 Zero-config boot | `tests/unit/boot.zero-config.test.ts` |
| 4 Cache rebuild | `tests/unit/cache.rebuild.test.ts` |
| 5 Provider parity | `tests/parity/` |
| 6 Accessibility assertions | `tests/component/` with `vitest-axe` |
| 7 Bundle budget | `npm run size` |
| 8 Cold start | `npm run smoke` |
| 9 Command parity | `tests/unit/commands.parity.test.ts` — asserts automation invokes only named scripts |
