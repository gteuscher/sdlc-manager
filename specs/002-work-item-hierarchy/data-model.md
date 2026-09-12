# Phase 1 Data Model: Work Item Hierarchy

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-11

Additions to the model in
[001's data-model.md](../001-sdlc-work-item-dashboard/data-model.md). The two
families there — **declared** (read from a manifest) and **observed** (read from a
system of record) — are unchanged, and this feature adds to both plus one derived
family that is new.

The rule that governs the whole feature: **the tree is derived, never stored.**
Nothing below is written to a system of record, and nothing is cached that cannot be
rebuilt from the flat item list.

---

## Declared additions

### `HierarchyDecl`

New, optional, on `ItemDiscovery`. Absent means the lifecycle is flat, and
everything renders exactly as it does today (FR-002, SC-005).

| Field | Type | Notes |
|---|---|---|
| `parentField` | `string` | The identity field on an item holding its parent's key. Named by the lifecycle; **never a field name the engine knows**. |
| `provider` | `ProviderId` | Which provider supplies it. Must be a declared provider. |
| `childLabel` | `string?` | Display noun for a child — "story", "task". Defaults to `items.unit`. |
| `parentLabel` | `string?` | Display noun for a parent — "epic". Defaults to `items.unit`. |

`parentLabel` and `childLabel` exist for the same reason `items.unit` does: an
interface that calls an epic "an item" is using the tool's vocabulary rather than
the engineer's.

### `ItemDiscovery` (amended)

| Field | Type | Notes |
|---|---|---|
| `hierarchy` | `HierarchyDecl \| null` | **New.** Null for every contract v1 manifest. |

---

## Observed additions

### `WorkItem` and `WorkItemSummary` (amended)

| Field | Type | Notes |
|---|---|---|
| `parentKey` | `ItemKey \| null` | **New.** The raw parent reference as read. Null when the item declares none, or the lifecycle declares no hierarchy. |
| `ownership` | `'owned' \| 'context'` | **New.** `context` means the item is shown to place another item and is **not** the engineer's work (FR-020, FR-021). |

`parentKey` is the *raw reference*, retained whether or not it resolves — the same
discipline `rawState` follows. An unresolvable parent is a fact worth showing, not
a reason to discard the reference.

`ownership` defaults to `owned`, so every existing item and every flat lifecycle is
unaffected.

---

## Derived entities

These exist only in memory, built per render from the flat list. None is cached,
none crosses the IPC surface, and none is authoritative.

### `ItemNode`

| Field | Type | Notes |
|---|---|---|
| `item` | `WorkItemSummary` | |
| `children` | `ItemNode[]` | Empty for a leaf. |
| `depth` | `number` | 0 at the root. Presentation only. |
| `problem` | `HierarchyProblem \| null` | Why this node is a root when it named a parent. |

### `HierarchyProblem`

| Field | Type | Notes |
|---|---|---|
| `kind` | `'cycle' \| 'parent_not_found' \| 'ambiguous_parent'` | Three named failures, no fourth. |
| `message` | `string` | Actionable, and safe to render (Principle V). |
| `parentKey` | `string \| null` | The reference that could not be honoured. |

A node carrying a problem is **still rendered**, promoted to a root. An item that
vanished because its parent was broken would leave the engineer no way to know it
existed (FR-022, FR-023, FR-024).

### `RolledUpAttention`

**Deliberately not an `AttentionSignal`.** FR-012 requires a parent's own signal to
be distinguishable from a descendant's, and FR-015 requires that a roll-up never
add to the attention count. Making it a different type carries both obligations into
every consumer through the type system rather than through discipline.

| Field | Type | Notes |
|---|---|---|
| `descendantCount` | `number` | How many **owned** descendants carry a signal. |
| `kinds` | `readonly AttentionKind[]` | Which kinds appear beneath, so the marker can say what is waiting. |
| `firstKey` | `ItemKey` | A descendant carrying one, so expansion can lead to it (FR-014). |

Consequences that follow from the type rather than from a rule:

- `countAttention()` accepts `AttentionSignal[]`. A `RolledUpAttention` is not one,
  so it **cannot** be counted (FR-015).
- A row may hold both its own `AttentionSignal` and a `RolledUpAttention`, and
  renders both — neither masks the other (FR-013).
- `descendantCount` counts owned descendants only, so a context item's signal never
  presents as work being asked of the engineer (FR-021b).

### `ItemForest`

| Field | Type | Notes |
|---|---|---|
| `roots` | `ItemNode[]` | Attention-first ordered, each child kept with its parent (FR-016). |
| `problems` | `HierarchyProblem[]` | Every problem found, for one summary report. |
| `nodesByKey` | `Map<ItemKey, ItemNode>` | Lookup, so expansion and filtering need no re-walk. |

---

## Ordering

One rule, applied at every level: a node sorts ahead of its siblings when its
**effective attention** is set, where effective attention is its own signal *or* a
roll-up from any owned descendant. Within each group the incoming order is
preserved, so the main process's recency ordering survives underneath — the same
stable-partition discipline `attentionFirst` already uses.

Children never leave their parent. A child needing attention raises **its parent's**
position; it does not float to the top of the list on its own.

---

## Validation rules

Added to the manifest schema in `src/core/manifest`, alongside the fifteen already
there. Numbering continues from `sdlc-manifest.md` §5.

16. `items.hierarchy` is permitted only when `sdlc` is **2 or greater**. A v1
    manifest declaring it is rejected naming the field and the version.
17. `items.hierarchy.provider` names a declared provider.
18. `items.hierarchy.parentField` is present and non-empty when `hierarchy` is
    present.
19. `items.hierarchy.parentField` names a field declared in `items.identity` — the
    same rule locator templating already obeys (rule 14), for the same reason: a
    reference to a field nothing produces can only ever be empty.

Rules 16 and 19 are the ones with teeth. 16 keeps the version bump meaningful; 19
turns "the hierarchy silently never resolves" into a load-time error naming the
field.

---

## What is *not* added

Recorded because each was considered and rejected:

- **No `children` field on the stored item.** It would be derived data in an
  authoritative position, and would go stale the moment one child moved.
- **No relationship cache.** The forest is rebuilt per render from data already in
  the query cache. A cached tree would be a second source of truth (Principle VI,
  Principle XIII).
- **No `depth` limit in the model.** FR-004 requires presenting whatever depth the
  data contains; a limit belongs to rendering, if anywhere.
- **No write path.** v1.0 is read-only, and re-parenting an item is a write.
