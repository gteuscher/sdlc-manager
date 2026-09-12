# Phase 0 Research: Work Item Hierarchy

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-11

Every decision below is checked against constitution v2.1.0. The binding constraints
on this feature are Principle XII (13 KB of bundle headroom) and Principle XI
(accessibility, with no tree primitive available), so both get their own section.

---

## 1. The contract change, and a gap it exposes

**Decision**: Add an optional `items.hierarchy` block to the manifest contract,
bump the contract version to **2**, and teach the reader to accept `[1, 2]`.

**Rationale**: Contract v1 cannot express a relationship at all — there is no field
for it — so this feature cannot be configuration-only without a contract change.
Supporting both versions is what keeps SC-005 true: every existing v1 manifest keeps
loading and rendering unchanged, and the fixture lifecycles need no edit.

**The gap this exposes, recorded rather than worked around**: `sdlc:` is an
**integer**, so the contract has a major version and no minor one. Adding an
optional, backward-compatible field is a MINOR change by any normal reading, but
there is nowhere to say so. That leaves two options and no good one:

- *Keep `sdlc: 1` and add the optional field.* New manifests then load in new
  readers and are **rejected by old ones** — the schema is `.strict()`, so an
  unrecognised key is an error — with a message about an unexpected key rather than
  about a version. The version-refusal machinery built for FR-047, which exists to
  say "this manifest is newer than me", would never fire.
- *Bump to `sdlc: 2` and support both.* Old readers refuse a v2 manifest **naming
  the version**, which is exactly the behaviour FR-047 specifies. Costs one integer
  and a set instead of a constant.

The second is chosen. The underlying gap — that the contract cannot express an
additive change — is worth an amendment to `sdlc-manifest.md` §6 later, and is
called out in [contracts/hierarchy.md](contracts/hierarchy.md) §5.

**Alternatives considered**: *Inferring hierarchy from the provider* (if Jira, look
for `parent`) — rejected outright by Principles II and VI, and the reason is
recorded in the spec's framing note. *A separate relationships file beside the
manifest* — a second artifact that can drift from the first, which is the exact
failure Principle II's "one artifact, not two copies" rule exists to prevent.

---

## 2. Where the tree is built

**Decision**: In `src/core/engine/hierarchy.ts`, as pure functions over the flat
item list. The main process assembles the flat list exactly as it does today, then
the renderer receives it flat and builds the view tree.

**Rationale**: Two candidate homes, and the deciding argument is what each makes
impossible.

Building the tree in the **main process** and sending a nested payload would make
the IPC surface carry a shape that the renderer cannot re-derive, which means the
query cache would hold a structure rather than a list — and a change to one item
would invalidate a tree. It also breaks the invalidation model: `ChangeEvent` names
what changed (`{ type: 'item', key }`), and a consumer holding a tree cannot apply
that without rebuilding anyway.

Building it in the **renderer** from the flat list keeps the wire format unchanged,
keeps every existing cache key valid, and makes the tree a render-time derivation of
data that is already there. Since `WorkItemSummary` gains only `parentKey` and
`ownership`, the IPC contract change is two scalar fields rather than a new shape.

The tree-building functions live in `src/core/engine` rather than in the component
because Principle IV requires them unit-testable without rendering anything, and
because the parity suite must run them against every fake.

**Alternatives considered**: *Nested payload from main* — above. *Building in the
component* — would make cycle detection and roll-up untestable without a DOM, which
Principle IV forbids.

---

## 3. The tree widget: disclosure, not `role="tree"`

**Decision**: A nested `<ul>` where each parent row carries a real `<button>` with
`aria-expanded` and `aria-controls`. **Not** a `role="tree"` / `role="treeitem"`
widget.

**Rationale**: This is the highest-risk decision in the feature, and the
constitution effectively makes it for us. Principle XI's scope note concedes that
manual screen-reader certification is out of scope for a single maintainer, and says
choosing accessibility-complete primitives "is what makes the rest of it achievable
by default". Radix ships **no tree primitive**.

A full ARIA tree widget requires roving `tabindex`, arrow-key navigation including
Left/Right to collapse and move to parent, Home/End, and typeahead. Hand-rolling
that is precisely the risk the scope note warns about, and `vitest-axe` cannot
detect a *wrong* keyboard model — only a missing role.

The disclosure pattern needs none of it. Every control is a real button in natural
tab order; expansion is `aria-expanded` on that button; the group is an ordinary
list. It is correct by construction, it is what a "left nav" of grouped rows
actually is, and it degrades to the current flat list when nothing nests.

The cost is honest: a 200-child group puts 200 tab stops in the order. That is
addressed by collapsing by default (§5) rather than by adopting a widget we cannot
verify.

**Alternatives considered**: *`role="treegrid"`* — the richest semantics and the
most to get wrong; revisit only if a screen-reader user reports the disclosure
pattern insufficient. *A third-party tree component* — would exceed the bundle
budget and adopt a component framework, which the constitution says needs an
amendment.

---

## 4. Distinguishing own attention from rolled-up attention

**Decision**: A distinct type. `AttentionSignal` is unchanged; a new
`RolledUpAttention` records how many descendants carry a signal and of which kinds.
A row may carry both, and renders both.

**Rationale**: FR-012 is the requirement most likely to be under-delivered, because
reusing the existing badge passes a careless review — the epic *is* marked, after
all. Making it a different type means every consumer has to decide what to do with
it, and a component cannot accidentally treat a roll-up as a direct signal by
passing the wrong variable.

It also settles FR-015 structurally: `countAttention` takes `AttentionSignal`s, and
a `RolledUpAttention` is not one, so a roll-up cannot be counted by construction
rather than by remembering not to.

**Alternatives considered**: *A boolean `rolledUp` flag on `AttentionSignal`* —
smaller, and every consumer that forgets to check it silently double-counts. *A
separate count field only* — loses which kind of signal is beneath, which FR-014
needs so expansion can lead the engineer to it.

---

## 5. Expansion state, and where it lives

**Decision**: Expanded keys in the URL query string (`?open=A,B`), collapsed by
default.

**Rationale**: FR-009 requires expansion in application navigation, and Principle
XIII says URL state is URL state. Collapsed-by-default is what makes SC-001
meaningful — "identify every group containing work that needs them **without
expanding anything**" is only a real test if the default is collapsed.

Storing the *expanded* set rather than the collapsed one keeps the URL short in the
common case, since most groups stay shut.

**The bound is real and needs handling**: an engineer who expands fifty groups
produces a long URL. The design caps the serialised set and drops the oldest
entries beyond it, because a truncated arrangement is better than an unusable
URL — and this is a view preference, not data.

**Alternatives considered**: *`localStorage`* — survives differently from the rest
of the view's state and cannot be returned to directly, failing FR-009. *Component
state* — lost on navigation, which FR-009 forbids explicitly.

---

## 6. Degenerate relationships

**Decision**: Detect at build time, in the engine, and report rather than throw.

- **Cycle**: depth-first with a visiting set. Every node in the cycle is promoted to
  a root and marked with a named problem. The rest of the list is unaffected.
- **Missing parent**: the child becomes a root, reporting that its parent could not
  be resolved (FR-023).
- **Self-parent**: the degenerate cycle, handled by the same path.
- **Multiple parents**: the manifest declares a single parent field, so this can
  only arise if a provider returns a list. The first is used deterministically and
  the ambiguity is reported (FR-024).

**Rationale**: Principle IX — the parent reference is untrusted producer output, and
a tracker with a broken link must not hang or crash the list. Principle X — every
one of these renders a deliberate, named state rather than a missing row.

An item that silently vanished because its parent was unresolvable would be the
worst outcome available, since the engineer would have no way to know it existed.

---

## 7. Ownership and context items

**Decision**: `WorkItemSummary` gains `ownership: 'owned' | 'context'`. A context
item is one pulled in solely to place an owned item, or shown beneath an owned
parent without being the engineer's own work.

**Rationale**: Resolved during specification (FR-020, FR-021). The list stays the
engineer's own work **plus the context needed to place it**, and the marking is what
keeps SC-012 honest — "every item listed qualifies under a stated ownership rule"
becomes "every item listed either qualifies, or is visibly marked as not qualifying".

`countAttention` and every success criterion filter on `ownership === 'owned'`. The
distinction must not rely on colour alone (FR-021a), matching the discipline the
existing attention badges already follow.

---

## 8. Bundle budget

Against Principle XII's 150 KB initial-JS budget, with **136.83 KB already spent**:

| Addition | Estimated gzip |
|---|---:|
| `src/core/engine/hierarchy.ts` | ~1.0 KB |
| `ItemTree.tsx` (disclosure group) | ~1.2 KB |
| `ItemRow.tsx` additions (context marking, roll-up marker) | ~0.8 KB |
| URL expansion serialisation | ~0.3 KB |
| **Projected total** | **~3.3 KB** |

Leaves roughly 10 KB of headroom. `size-limit` enforces it in `npm run verify`, so
the projection is checked rather than trusted.

**If it fails**: move the items route behind a lazy boundary (it is currently in the
initial chunk), or drop FR-026's virtualisation and cap rendered children with a
"show all" affordance. **Not** raise the budget.

---

## 9. Scale

**Decision**: Render children only when a group is expanded. Cap the rendered
children of a single group, with the remainder counted and revealed on demand.

**Rationale**: SC-007 requires that expanding a 200-child parent leave the rest of
the list usable. Collapsed-by-default means the common case renders one row per
group. A cap plus a count is the same treatment `TestResultsArtifact` already gives
a run with thousands of cases, so it is a pattern this codebase has rather than a
new one — Principle VII's duplication-under-three rule applies, and this is the
second occurrence.

**Alternatives considered**: *A virtualised list* — a new dependency and a
significant bundle cost for a case the cap handles; revisit if a real lifecycle
produces groups in the thousands.
