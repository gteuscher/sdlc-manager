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
| `evidence` | no | Where a `manual` gate's decision is recorded. |
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

## 8. Open questions for `/speckit-plan`

1. **Staleness / provenance.** Should the contract express that one state's artifacts derive from
   another's, enabling the reference dashboard's *out of date* marker? A `derives_from: [state-id]`
   field on a state would be the minimal form. It is arguably the highest-value signal here and is
   currently unrepresentable.
2. **Gate result storage.** For `kind: manual` in a read-only v1.0, where does the decision live?
   The `evidence` locator assumes some provider already records it; a lifecycle with no such field
   has no way to express a manual gate's result.
3. **Per-item vs per-project items.** The Gamesmith example makes an entire game one work item,
   whereas the Acme example makes each ticket one. Both fit, but nothing in the contract states
   the granularity — worth asserting explicitly.
4. **Machine-readable schema.** This document is normative prose; the validation rules in §5 should
   also exist as an executable schema so FR-044's field-level errors are generated rather than
   hand-written. That is a plan deliverable.
