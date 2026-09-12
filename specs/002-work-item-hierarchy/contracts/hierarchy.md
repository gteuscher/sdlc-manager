# Contract Amendment: Item Hierarchy (manifest contract v2)

**Status**: Draft · **Created**: 2026-09-11 · **Feature**: [spec.md](../spec.md)
**Amends**: [contracts/sdlc-manifest.md](../../001-sdlc-work-item-dashboard/contracts/sdlc-manifest.md)
**Satisfies**: FR-001 – FR-005, FR-019 – FR-021, Constitution Principles II and VI

This amendment adds one optional block to the lifecycle manifest, letting a package
declare that its work items form a tree. It is additive: a manifest that omits it
behaves exactly as it does today.

---

## 1. The block

```yaml
sdlc: 2                          # REQUIRED to use this block. See §4.

items:
  unit: story                    # as before — the noun for one item
  hierarchy:
    parent_field: parentKey      # REQUIRED. The identity field holding the parent's key.
    provider: tracker            # REQUIRED. Which provider supplies it.
    parent_label: epic           # Optional. Display noun for a parent. Default: items.unit
    child_label: story           # Optional. Display noun for a child.  Default: items.unit
  identity:
    correlate_on: key
    patterns:
      tracker: "(?<key>[A-Z]+-[0-9]+)"
    # `parent_field` must name a field this block yields — see rule 19.
```

### Field reference

| Field | Required | Meaning |
|---|---|---|
| `parent_field` | yes | The field on an item whose value is its parent's correlation key. Empty or absent on an item means that item is a root. |
| `provider` | yes | The provider that supplies the field. Must be declared in `providers`. |
| `parent_label` | no | The engineer's noun for a parent — "epic", "milestone", "project". Defaults to `items.unit`. |
| `child_label` | no | The engineer's noun for a child. Defaults to `items.unit`. |

## 2. Design rules this shape obeys

1. **Declared, never inferred.** The dashboard nests items because a manifest said
   to, and reads the relationship from the field that manifest names. There is no
   rule anywhere of the form "if the provider is Jira, look for `parent`" — such a
   rule would violate Principle II and would have to be rewritten for every tracker
   added later.
2. **One parent.** An item names at most one parent. Trackers that permit several
   are a degenerate case to be reported (§3), not a supported shape.
3. **The relationship is read, never written.** Nothing here lets the dashboard
   re-parent an item. v1.0 is read-only, and this amendment does not change that.
4. **Absence is flat.** A manifest without `hierarchy` produces the list exactly as
   it renders today. This is asserted, not assumed (SC-005).
5. **The vocabulary is the engineer's.** `parent_label` and `child_label` exist for
   the same reason `items.unit` does — an interface that calls an epic "an item" is
   using the tool's words instead of the user's.

## 3. Degenerate relationships

A relationship read from a system of record is untrusted producer output
(Principle IX). Each case below is **reported and rendered**, never dropped and
never followed into a loop.

| Case | Behaviour |
|---|---|
| `parent_field` names an item that does not exist, is not visible, or is outside the registered repositories | The child becomes a root, reporting `parent_not_found` and naming the unresolved key (FR-023). |
| An item is its own ancestor, directly or through a chain | Every item in the cycle becomes a root, each reporting `cycle`. The rest of the list is unaffected (FR-022). |
| A provider returns several parents | The first is used deterministically and `ambiguous_parent` is reported. The item appears **once** (FR-024). |
| The field is declared but every item returns nothing for it | Every item is a root. The list is flat and correct; nothing is reported, because nothing is wrong. |

An item must never disappear because its relationship was broken. An engineer who
cannot see an item has no way to know it exists, which is a worse outcome than any
of the above.

## 4. Versioning, and a gap in the scheme

Using `items.hierarchy` **requires `sdlc: 2`**. A contract v1 manifest declaring it
is rejected, naming the field and the version (validation rule 16).

The reader accepts contract versions **1 and 2**. Every existing manifest keeps
loading unchanged.

**The gap, recorded rather than worked around.** `sdlc:` is an integer: the contract
has a major version and no minor one. Adding an optional, backward-compatible field
is a MINOR change by any normal reading, and there is nowhere to express that. The
two available options were:

- Keep `sdlc: 1` and add the optional field. New manifests would then be **rejected
  by older readers** with a message about an unrecognised key — the schema is
  strict — rather than about a version. The version-refusal behaviour built for
  FR-047, whose entire purpose is to say "this manifest is newer than I am", would
  never fire.
- Bump to `sdlc: 2` and support both. An older reader refuses a v2 manifest *naming
  the version it found*, which is exactly what FR-047 specifies.

The second is chosen. The real fix is a minor channel in the contract version — a
`sdlc: 2.1` form, or a separate `contract_minor` — so that additive changes stop
consuming major versions. That is an amendment to
[sdlc-manifest.md](../../001-sdlc-work-item-dashboard/contracts/sdlc-manifest.md) §6
and is **out of scope here**, recorded so the next additive change does not
rediscover it.

## 5. Worked example: a tracker with epics

```yaml
sdlc: 2
id: acme-delivery
name: Acme Delivery
version: 3.0.0

providers:
  - id: tracker
    kind: jira
    base_url: https://acme.atlassian.net
    email: engineer@acme.example
  - id: repo
    kind: filesystem
    root: "."

ownership:
  state: tracker
  title: tracker
  assignee: tracker
  artifacts: repo

items:
  unit: story
  hierarchy:
    parent_field: parentKey
    provider: tracker
    parent_label: epic
    child_label: story
  discover:
    - provider: tracker
      query: "assignee = currentUser() AND statusCategory != Done"
  identity:
    correlate_on: key
    patterns:
      tracker: "(?<key>[A-Z]+-[0-9]+)"

states:
  - id: refine
    name: Refinement
    awaits_human: true
    maps: { tracker: ["To Refine"] }
  - id: build
    name: In progress
    maps: { tracker: ["In Progress"] }
  - id: closed
    name: Closed
    terminal: true
    maps: { tracker: ["Done"] }
```

An engineer assigned `ACME-100` (an epic) with `ACME-101` and `ACME-102` beneath it
sees one row for the epic. If `ACME-101` rests in `refine` — declared as awaiting a
human — the epic carries a **descendant** marker, visibly distinct from the marker
it would carry if the epic itself rested there.

## 6. What this contract does not add

- **No `children` declaration.** The relationship points one way, from child to
  parent, because that is the direction trackers record it and the only direction
  that stays correct when an item moves.
- **No depth limit.** The interface presents whatever depth the data contains.
- **No ordering field.** Children are ordered by the same rule as roots: attention
  first, incoming order preserved beneath.
- **No cross-repository relationships.** A parent and child belong to the same
  registered repository. A reference that escapes it reports `parent_not_found`,
  which is honest — the dashboard genuinely cannot see it.
