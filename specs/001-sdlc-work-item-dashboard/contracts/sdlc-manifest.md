# Contract: SDLC Lifecycle Manifest

**Status**: Draft
**Created**: 2026-09-11
**Feature**: [spec.md](../spec.md)
**Satisfies**: FR-039 – FR-046, Constitution Principles II and VI

This document defines the shape of the declaration an SDLC package carries so that an agent and
this dashboard read the same lifecycle. It is a contract on the **SDLC package**, not on the
dashboard: a package that does not carry this file is unsupported (FR-045).

---

## 1. Placement and discovery

The manifest lives at the root of the agent package, alongside whatever manifest that agent
platform requires:

```
my-sdlc/
  .claude-plugin/plugin.json     # platform manifest (Claude Code) — untouched
  sdlc.yaml                      # THIS CONTRACT
  skills/
  agents/
```

**Why a separate file rather than a key inside `plugin.json`.** The platform manifest's schema is
owned by the agent vendor; adding a lifecycle to it couples this contract to one platform and
risks collision with future keys. A sibling file works for a Claude Code plugin, for a bare skill
directory, and for any other agent runtime, and it can be validated and version-controlled on its
own.

Discovery: the dashboard scans the agent package locations available on the machine and treats any
directory containing a readable `sdlc.yaml` as an available SDLC package.

Format is YAML, matching the reference SDLC's existing convention of YAML gate definitions.

---

## 2. Design rules this shape obeys

1. **Declared, never inferred.** Every state, gate, and artifact the dashboard renders appears
   here. Nothing is read out of skill prose (FR-041).
2. **Ordered states, optional graph.** `states` is an ordered list, which alone defines a linear
   lifecycle. `transitions` is optional and, when present, describes rework loops and branches
   that the order cannot express.
3. **One uniform gate shape.** Validation, verification, and integration-backed gates differ only
   by `kind`, so the engine treats them interchangeably (Principle II).
4. **Unambiguous ownership.** Every work-item field is owned by exactly one provider. This is the
   enforcement point for Principle VI's composition rule.
5. **Read-only by default.** Every `write_back` flag defaults to `false`. A package must opt in
   explicitly before anything is written to a system of record (FR-033, Principle V).
6. **Absence is never success.** A gate with no recorded evaluation is `not_evaluated`, which is
   distinct from `failed` and never renders as passed (FR-014).

---

## 3. Annotated reference

```yaml
# ─── Contract and identity ────────────────────────────────────────────────────
sdlc: 1                        # REQUIRED. Manifest contract version (integer).
                               # The dashboard refuses a major version it does not know.
id: acme-standard              # REQUIRED. Stable slug, unique per machine. Never reused.
name: Acme Standard SDLC       # REQUIRED. Human-readable.
version: 2.3.0                 # REQUIRED. Package version; recorded per repository (FR-043).
description: >                 # Optional.
  Spec-driven lifecycle with a QA gate and a release checkpoint.

# ─── Providers ────────────────────────────────────────────────────────────────
# Every external system this lifecycle reads. Referenced by id everywhere below.
providers:
  - id: repo
    kind: filesystem           # filesystem | jira | github | checks
    root: "."                  # relative to the registered repository
  - id: tracker
    kind: jira
    project: ENG               # provider-specific settings; validated by the adapter
  - id: ci
    kind: github-checks

# ─── Field ownership (Principle VI) ───────────────────────────────────────────
# Exactly one provider owns each field. Composition is legal; ambiguity is not.
ownership:
  state: tracker               # who decides which state an item is in
  title: tracker
  assignee: tracker
  artifacts: repo

# ─── Item discovery and identity ──────────────────────────────────────────────
items:
  unit: ticket                 # Optional, default "item". The noun the interface uses for one
                               # work item — "ticket", "story", "game". Display only.
  discover:                    # one or more rules; an item qualifying under any is listed once
    - provider: tracker
      query: "assignee = currentUser() AND statusCategory != Done"
    - provider: repo
      glob: "docs/stories/*/story.md"
  identity:
    # How an item found by one provider is recognised as the same item in another.
    correlate_on: key          # e.g. ENG-1423 appears in the tracker and in the folder name
    patterns:
      repo: "docs/stories/(?<key>[A-Z]+-[0-9]+)/story.md"

# ─── States (ORDERED) ─────────────────────────────────────────────────────────
states:
  - id: spec
    name: Specification
    description: The change is described and agreed before work starts.
    awaits_human: false        # true => items resting here raise an "input needed" signal
    maps:                      # raw provider values that mean "this state"
      tracker: ["Spec", "Specification", "In Refinement"]
    artifacts:
      - id: spec-doc
        name: Specification
        kind: markdown         # markdown | tracker | test-results
        provider: repo
        path: "docs/stories/{item.key}/spec.md"
        required: true         # a required artifact that is absent is reported, not hidden
    gates:
      - id: spec-approved
        name: Specification approved
        kind: manual           # manual | artifact | check | field
        awaits_human: true     # this gate is what the human is being waited on for
        blocking: true
        evidence:
          provider: tracker
          field: customfield_10042

  - id: build
    name: Implementation
    maps:
      tracker: ["In Progress"]
    artifacts:
      - id: design-notes
        kind: markdown
        provider: repo
        path: "docs/stories/{item.key}/design.md"
        required: false
    gates:
      - id: tests-pass
        name: Automated tests pass
        kind: check
        provider: ci
        check: unit-tests      # the named check whose result this gate reads
        blocking: true
        configurable: true     # a repository may override `check` (see repo_config)
      - id: review-approved
        name: Code review approved
        kind: field
        provider: tracker
        field: reviewStatus
        passes_when: { equals: "approved" }
        blocking: true

  - id: release
    name: Release
    maps:
      tracker: ["Ready for Release", "Released"]
    terminal: true             # items reaching a terminal state leave the active list
    gates: []

# ─── Transitions (optional) ───────────────────────────────────────────────────
# Omit entirely for a strictly linear lifecycle. Declare only what the order cannot express.
transitions:
  - from: build
    to: spec
    name: Sent back for re-specification     # a rework loop
  - from: build
    to: release
    requires: [tests-pass, review-approved]  # gate ids declared on `from`

# ─── Write-back (all default false) ───────────────────────────────────────────
write_back:
  transitions: false           # may the dashboard move an item's state?
  gate_results: false          # may it record a gate decision in the system of record?
  records:                     # where a transition record goes, if enabled at all
    provider: tracker
    as: comment                # comment | field | file

# ─── Per-repository configuration (FR-024) ────────────────────────────────────
# What a repository adopting this SDLC must or may set. Renders as the repo's config form.
repo_config:
  - key: providers.tracker.project
    title: Jira project key
    type: string
    required: true
  - key: gates.tests-pass.check
    title: CI check name
    type: string
    required: false
    default: unit-tests
```

---

## 4. Field reference

### Top level

| Field | Required | Meaning |
|---|---|---|
| `sdlc` | yes | Manifest contract version. Integer. See §6. |
| `id` | yes | Stable package slug. Identifies the SDLC across upgrades. |
| `name` | yes | Display name. |
| `version` | yes | Package version, recorded per repository so two repos may follow different versions. |
| `description` | no | One or two sentences. |
| `providers` | yes | External systems this lifecycle reads. At least one. |
| `ownership` | yes | Field → provider map. See §5. |
| `items` | yes | How items are discovered and correlated across providers. |
| `states` | yes | Ordered list. At least one. |
| `transitions` | no | Non-linear moves. Absent means strictly linear. |
| `write_back` | no | Opt-in writes. Absent means all writes disabled. |
| `repo_config` | no | Settings a repository supplies. Absent means none needed. |

### State

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within the manifest. Stable across versions; renaming an `id` is a removal plus an addition. |
| `name` | yes | Tab label. |
| `description` | no | Shown in the state tab. |
| `awaits_human` | no | Default `false`. `true` raises an "input needed" signal for items resting here (FR-006). |
| `terminal` | no | Default `false`. Items here leave the active list. |
| `maps` | no | Provider → list of raw values meaning this state. Required for any provider that owns `state`. |
| `artifacts` | no | Declarations rendered in this state's tab. |
| `gates` | no | Conditions this state must satisfy. |

### Gate

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within the manifest, so transitions can reference it. |
| `name` | yes | Display name. |
| `kind` | yes | `manual` (a human decision), `artifact` (a declared artifact exists/matches), `check` (an external check result), `field` (a provider field holds a value). |
| `blocking` | no | Default `true`. A non-blocking gate is reported but does not stall the item. |
| `awaits_human` | no | Default `false`. `true` means a failed or unevaluated result is waiting on the engineer specifically. |
| `configurable` | no | Default `false`. `true` permits repository override via `repo_config`. |
| `provider` | for `check`/`field` | Which provider supplies the result. |
| `evidence` | **required for `manual`** | A provider-readable location where the decision is recorded. Required because v1.0 cannot record a decision itself without breaking read-only, and storing it locally would make our cache authoritative for something no system of record holds. |
| `passes_when` | for `field` | Condition on the field value. |

Every gate resolves to exactly one of `passed`, `failed`, `not_evaluated`. There is no fourth
value and no default to `passed`.

### Artifact

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within its state. |
| `name` | no | Defaults to `id`. |
| `kind` | yes | `markdown`, `tracker`, or `test-results`. |
| `provider` | yes | Must reference a declared provider. |
| `path` / `field` / `run` | by kind | Locator, supporting `{item.<field>}` templating. |
| `required` | no | Default `false`. A required artifact that is missing is reported in place (FR-019). |

---

## 5. Validation rules

A manifest failing any rule is rejected with the offending field named, and is not partially
loaded (FR-044).

1. `sdlc` is present and its major version is one the reader supports.
2. `id`, `name`, `version` are present and non-empty.
3. `states` is non-empty; every `state.id` is unique and non-empty.
4. Every `gate.id` is unique across the whole manifest.
5. Every `artifact.id` is unique within its state.
6. Every `provider` reference — in `ownership`, `artifacts`, `gates`, `items` — names a declared
   provider.
7. **Every field in `ownership` names exactly one provider.** A field owned by two providers is a
   validation error, not a runtime tie-break. *(Principle VI)*
8. Any provider owning `state` declares `maps` on every non-terminal state, so every state is
   reachable from that provider's vocabulary.
9. **No raw value appears in `maps` for more than one state.** An ambiguous mapping is rejected.
10. Every `transition.from` and `transition.to` names a declared state.
11. Every id in `transition.requires` names a gate declared on that transition's `from` state.
12. Every `repo_config.key` resolves to a real path in the manifest, and any gate it targets is
    `configurable: true`.
13. `write_back.records` is present whenever `write_back.transitions` or `write_back.gate_results`
    is `true`.
14. Templating in a locator references only fields declared in `items.identity`.
15. Every gate with `kind: manual` declares an `evidence` locator. A manual gate with nowhere to
    read its decision from can never be anything but `not_evaluated`, so the manifest is rejected
    rather than silently producing a gate that never resolves.

**Granularity**: one match from an `items.discover` rule is one work item. A lifecycle whose rule
matches a project file therefore has one item per project; one matching a ticket query has one item
per ticket. Both are valid — `items.unit` supplies the noun the interface should use.

**Executable form**: these rules exist as a Zod schema in `src/core/manifest`, which generates the
field-level errors above. This document is the normative prose; the schema is the single
implementation. Two hand-maintained copies would drift.

---

## 6. Versioning

Two independent versions, deliberately separated:

- **`sdlc:`** — the contract version, owned by this project. Incremented when this shape changes.
  A reader refuses a major version it does not know, naming the version it found, rather than
  loading a manifest it may misread.
- **`version:`** — the package's own version, owned by the SDLC author. Recorded per repository
  (FR-043), so two repositories may follow different versions of the same SDLC simultaneously.

**Upgrade behaviour** (FR-046): when a package's `version` changes and a state `id` an item
occupies no longer exists, that item is marked unmapped and keeps its recorded value. It is never
dropped and never reassigned to a nearby state. This is why `state.id` must be stable and renaming
one counts as a removal plus an addition.

---

## 7. Worked example: fitting Gamesmith

Gamesmith today declares no lifecycle — its stages live in skill prose and in
`project.json.stages.*` at runtime. This is what adopting the contract would look like, and it is
the test of whether this shape generalises beyond a ticket-driven SDLC:

```yaml
sdlc: 1
id: gamesmith
name: Gamesmith
version: 0.1.0

providers:
  - id: repo
    kind: filesystem
    root: ".gamesmith"

ownership:
  state: repo                  # no tracker at all; the filesystem is the system of record
  title: repo
  artifacts: repo

items:
  discover:
    - provider: repo
      glob: "project.json"     # one item per game project
  identity:
    correlate_on: name

states:
  - id: brainstorm
    name: Brainstorm
    maps: { repo: ["brainstorm"] }
    artifacts:
      - { id: ideas, kind: markdown, provider: repo, path: "brainstorm.md" }
  - id: spec
    name: Spec
    awaits_human: true         # the spec must be accepted by a human
    maps: { repo: ["spec"] }
    artifacts:
      - { id: spec, kind: markdown, provider: repo, path: "spec.md", required: true }
    gates:
      - id: spec-accepted
        name: Spec accepted
        kind: field
        provider: repo
        field: "stages.spec.accepted"
        passes_when: { equals: true }
        awaits_human: true
  - id: sprints
    name: Sprints
    maps: { repo: ["sprints"] }
    artifacts:
      - { id: sprint-files, kind: markdown, provider: repo, path: "sprints/*.md" }
    gates:
      - id: no-open-escalations
        name: No open escalations
        kind: artifact
        provider: repo
        path: "escalations/*.open.json"
        passes_when: { absent: true }
        awaits_human: true
```

**What this exercise surfaced:** Gamesmith's *out-of-date* status — a stage stale because an
upstream stage changed, computed from `derived_from[x] < stages[x].version` — has **no
representation in this contract.** It is not a state (an item is not "in" it), and not a gate
(it is not a condition on progressing). It is a property of the relationship between states.

Recorded as an open question rather than papered over, because it is the single most useful signal
in the reference dashboard.

---

## 8. Resolved: derivation staleness is out of scope for v1.0

The *out of date* marker — a later state invalidated because an earlier one changed — is
**deliberately absent from contract v1 and from v1.0 of the dashboard.** Decided 2026-09-11.

**No `derives_from` field is needed.** The ordered `states` list already encodes the dependency:
editing an earlier state's artifacts implies every later state may be stale. An explicit
provenance field would only earn its keep for a non-linear lifecycle where `transitions` break the
implied order, and no such need has been demonstrated.

**When it is built, it asks rather than decides.** Derivation staleness will be surfaced as a
question for the engineer — "the spec changed after this was written; is it still valid?" — not
as an automatic invalidation. This matches the reference dashboard, where stale never
auto-invalidates and the choice is always re-run or accept-as-is. Auto-invalidation is the failure
mode to avoid: a whitespace edit to an early document should not mark six downstream states stale.

**Why v1.0 can defer it.** The dashboard is read-only (FR-034), so it can never *cause* a state to
go out of date. Note that this does not mean staleness cannot *occur* — an agent or engineer
editing an early artifact outside the dashboard creates it regardless. v1.0 simply does not detect
or display it, which is a reporting gap rather than an incorrect state.

**Do not confuse the two staleness concepts.** They are unrelated and only one is in v1.0:

| Concept | In v1.0? | Meaning |
|---|---|---|
| **Reconciliation staleness** | **Yes** — FR-002, FR-018, FR-037 | The dashboard's cached copy is older than the system of record, or a provider is unreachable. A property of *this application's* freshness. |
| **Derivation staleness** | **No** — deferred | A later state's work was derived from an earlier state that has since changed. A property of *the work itself*, independent of any dashboard. |

## 9. Question log

All questions raised against this contract are resolved. Reasoning is in
[research.md](../research.md) §16.

| Question | Resolution |
|---|---|
| Derivation staleness / `derives_from` | Deferred out of v1.0 — see §8. No field added; the ordered state list already implies the dependency. |
| Where a `manual` gate's result lives | `evidence` is required for `kind: manual` (rule 15). v1.0 cannot record a decision without breaking read-only, and recording it locally would make the cache authoritative for something no system of record holds. |
| Per-item vs per-project granularity | One discovery match is one work item; `items.unit` names it. Asserted in §5, no structural change. |
| Machine-readable schema | The Zod schema in `src/core/manifest` is the executable form; this document is the normative prose. |
