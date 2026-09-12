# Phase 1 Data Model: SDLC Work Item Dashboard

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-11

Types live in `src/core/model`. They are plain TypeScript with no dependency on Electron, React, or
Node, so the engine that operates on them is testable in isolation (Principle IV).

Two families are deliberately separated:

- **Declared** — read from an SDLC package's manifest. Immutable for a given package version.
- **Observed** — read from a system of record and reconciled into the cache. Never authoritative;
  always rebuildable (Principle VI).

Nothing in the observed family may contribute a state, gate, or artifact that the declared family
did not define. That asymmetry is the data-model expression of Principle II.

---

## Declared entities

### `SdlcPackage`

The installed agent skill or plugin that executes a lifecycle, and the unit a repository is
associated with.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable slug from `sdlc.yaml`. Identity across upgrades. |
| `name` | `string` | Display name. |
| `version` | `string` | Package author's version. Recorded per repository (FR-043). |
| `contractVersion` | `number` | The manifest's `sdlc:` value. Refused if unsupported (FR-047). |
| `path` | `string` | Absolute location on disk. |
| `definition` | `SdlcDefinition \| null` | `null` when the package carries no manifest — the package is then listed as unsupported (FR-045). |
| `problem` | `ManifestProblem \| null` | Why the definition is absent or invalid. |

### `SdlcDefinition`

| Field | Type | Notes |
|---|---|---|
| `states` | `State[]` | **Ordered.** Order alone defines a linear lifecycle. |
| `transitions` | `Transition[]` | Empty means strictly linear. |
| `providers` | `ProviderDecl[]` | Every external system this lifecycle reads. |
| `ownership` | `Record<OwnedField, ProviderId>` | Exactly one provider per field (Principle VI). |
| `items` | `ItemDiscovery` | Discovery rules, correlation, and display noun. |
| `writeBack` | `WriteBackPolicy` | All flags default `false`. |
| `repoConfig` | `ConfigField[]` | What a repository must supply. |

### `State`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique, stable. Renaming is removal plus addition (FR-046). |
| `name` | `string` | Tab label. |
| `description` | `string?` | |
| `awaitsHuman` | `boolean` | Default `false`. Drives the "input needed" signal. |
| `terminal` | `boolean` | Default `false`. Terminal items leave the active list. |
| `maps` | `Record<ProviderId, string[]>` | Raw provider values meaning this state. |
| `artifacts` | `ArtifactDecl[]` | |
| `gates` | `GateDecl[]` | |
| `ordinal` | `number` | Derived from array position. The only ordering source. |

### `GateDecl`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique across the manifest, so transitions can reference it. |
| `name` | `string` | |
| `kind` | `'manual' \| 'artifact' \| 'check' \| 'field'` | One shape for all four (Principle II). |
| `blocking` | `boolean` | Default `true`. |
| `awaitsHuman` | `boolean` | Default `false`. |
| `configurable` | `boolean` | Default `false`. Permits repository override. |
| `provider` | `ProviderId?` | Required for `check` and `field`. |
| `evidence` | `Locator?` | **Required for `manual`** — see research.md §16 Q1. |
| `passesWhen` | `Condition?` | Required for `field` and `artifact`. |

### `ArtifactDecl`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique within its state. |
| `name` | `string?` | Defaults to `id`. |
| `kind` | `'markdown' \| 'tracker' \| 'test-results'` | |
| `provider` | `ProviderId` | |
| `locator` | `Locator` | Supports `{item.<field>}` templating. |
| `required` | `boolean` | Default `false`. A missing required artifact is reported in place (FR-019). |

---

## Observed entities

### `WorkItem`

| Field | Type | Notes |
|---|---|---|
| `key` | `string` | Correlation identity across providers. |
| `title` | `string` | From the owning provider. |
| `repositoryId` | `RepositoryId` | |
| `packageId` / `packageVersion` | `string` | Which lifecycle, at which version. |
| `stateId` | `string \| UNMAPPED` | Resolved state, or unmapped. |
| `rawState` | `string` | The provider's raw value, always retained (FR-005). |
| `gateResults` | `GateResult[]` | |
| `attention` | `AttentionSignal \| null` | Derived, never stored by a provider. |
| `reconciledAt` | `Timestamp` | Per FR-002. |
| `freshness` | `'fresh' \| 'stale' \| 'unreachable'` | Reconciliation staleness only — see below. |

`UNMAPPED` is a distinct sentinel, not `null` and not a state id. An item whose recorded status
matches no declared state, or whose state vanished in a package upgrade, carries `UNMAPPED` and
keeps `rawState` for display. It is never coerced to a nearby state.

### `GateResult`

| Field | Type | Notes |
|---|---|---|
| `gateId` | `string` | |
| `status` | `'passed' \| 'failed' \| 'not_evaluated'` | **Three values. There is no fourth, and no default to `passed`.** |
| `evaluatedAt` | `Timestamp \| null` | `null` exactly when `not_evaluated`. |
| `evidence` | `EvidenceRef \| null` | Where the result was read from. |
| `detail` | `string \| null` | Why it passed or failed (Principle V). |

A gate with no result present is materialised as `not_evaluated`, never omitted. Omission would
let a consumer treat absence as success, which FR-014 forbids.

### `AttentionSignal`

| Field | Type | Notes |
|---|---|---|
| `kind` | `'input_needed' \| 'gate_failed'` | The two FR-006 requires distinguishing. |
| `reason` | `string` | Human-readable, actionable. |
| `stateId` / `gateId` | `string?` | What is waiting. |

Derived purely from `(State.awaitsHuman, GateDecl.awaitsHuman, GateResult.status)` by a pure
function in `src/core/engine`. Because it is derived rather than stored, it survives a restart and
a cache wipe (FR-007).

### `Repository`

| Field | Type | Notes |
|---|---|---|
| `id` / `name` / `path` | `string` | |
| `packageId` / `packageVersion` | `string` | Association recorded explicitly (FR-043). |
| `config` | `Record<string, unknown>` | Validated against the package's `repoConfig`. |
| `providerStatus` | `Record<ProviderId, ProviderHealth>` | Which providers are configured and reachable (FR-026). |

### `TransitionRecord`

Local, append-only, never written to a system of record in v1.0 (FR-032, FR-033).

| Field | Type | Notes |
|---|---|---|
| `itemKey` / `fromStateId` / `toStateId` | `string` | |
| `observedAt` | `Timestamp` | When the dashboard saw it, not when it happened. |
| `gateResultsAtTransition` | `GateResult[]` | Snapshot, so the record explains *why*. |
| `source` | `ProviderId` | Which provider reported it. |

Snapshotting gate results rather than referencing them is deliberate: the Planned Direction
constraint says the record should capture what a later write-back would need, and a later
transition write must be able to state the evidence as it stood at the time.

### `Conversation`

| Field | Type | Notes |
|---|---|---|
| `itemKey` / `stateId` | `string` | The scoping key — one conversation per state per item (FR-029). |
| `messages` | `Message[]` | Ordered `{role, content, at}` records. |

Stored as structured messages rather than rendered text, so a future session-based console can
continue a transcript rather than discard it (Planned Direction).

---

## Two kinds of staleness — do not conflate

| | Field | In v1.0 | Meaning |
|---|---|---|---|
| Reconciliation staleness | `WorkItem.freshness` | **Yes** | Our cached copy is older than the system of record, or the provider is unreachable. |
| Derivation staleness | *none* | **No** | Later work invalidated by an earlier state changing. Deferred; no field exists, deliberately. |

They share the word "stale" and are unrelated. Conflating them produces an item marked out of date
because a Jira poll timed out.

---

## Validation rules

Enforced by the Zod schema in `src/core/manifest`, which is the executable form of
[contracts/sdlc-manifest.md](contracts/sdlc-manifest.md) §5. Rejection names the offending field
path and, where `yaml` supplies it, the source line. No partial load (FR-044).

The two that carry the most weight:

- **Exactly one provider owns each field.** Two owners is a validation error, never a runtime
  tie-break (Principle VI, FR-048).
- **No raw value maps to two states.** Ambiguity is rejected at load, not resolved at display time
  (FR-048).

---

## Cache

Stored as versioned JSON under the app user-data directory:

```
<userData>/cache/v1/
  repositories.json
  items/<repositoryId>.json
  transitions/<repositoryId>.jsonl
  conversations/<itemKey>/<stateId>.json
```

The `v1` segment is a cache schema version: an unrecognised version is discarded and rebuilt rather
than misread. Deleting the whole directory is a supported recovery path, and a test asserts a
rebuild reproduces identical `WorkItem` state, which is how Principle VI's "no competing
authoritative store" is verified rather than asserted.

Credentials never appear here. They live only in `safeStorage` and never cross into the renderer.
