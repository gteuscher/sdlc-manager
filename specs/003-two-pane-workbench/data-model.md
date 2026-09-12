# Phase 1 Data Model: Two-Pane Workbench

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-12

This feature adds **no domain data**. It arranges what
[001](../001-sdlc-work-item-dashboard/data-model.md) already produces: no entity
gains a field, no provider is consulted differently, no manifest field is read,
and nothing new crosses the IPC surface.

What it does add is a small amount of state describing how the engineer has
arranged their workbench. That is recorded here because *where each piece lives*
is the design decision worth pinning down — Principle XIII turns on it, and
getting it wrong is how a view preference ends up in a system of record.

---

## Pane Layout State

Four values, three homes. None of them is domain state, and none is ever
authoritative for anything about the work.

| Value | Home | Why there |
|---|---|---|
| Selected item | **URL path** — `/items/:key` | Another person or another session must be able to arrive at it (FR-007, 001's FR-015). Already true today; unchanged. |
| Selected state tab | **URL query** — `?tab=` | Same reason. **Renamed from `?state=`** — see below. |
| List filters and search | **URL query** — `?repository=`, `?sdlc=`, `?state=`, `?q=` | A filtered view is worth returning to and worth sharing (FR-016). Already true today; unchanged. |
| List pane collapsed | **Browser-local preference** | FR-011 requires it to survive a restart, which a URL cannot do, and it is a personal preference that should not travel in a shared link. The written justification Principle XIII requires is in [research.md §3](research.md). |

### The renamed parameter

`?state=` means two different things in the two components that will now share a
view:

| Component | Reads `?state=` as | Becomes |
|---|---|---|
| `Items` (list pane) | The state **filter** | `?state=` — unchanged |
| `ItemDetail` (detail pane) | The selected **tab** | `?tab=` |

Today they are separate routes and never share a query string. In one view they
would read and write the same key: filtering the list would move the detail's tab,
and changing tab would filter the list. Both behaviours are required — FR-013 and
001's FR-015 — so the collision is resolved by naming rather than by precedence.

This is the only change to any existing URL, and it is a bug fix: the alternative
is shipping a view whose two halves silently rewrite each other's state.

---

## Derived, not stored

Two values the shell needs and must **not** persist, because each is a function of
something already recorded:

| Value | Derived from |
|---|---|
| Whether an item is selected | Whether the route matched `/items/:key` |
| Whether the selected item appears in the filtered list | The selected key, against the list the current filters produce |

The second matters for FR-015: when a filter excludes the item being read, the
detail keeps showing it and the list says so. Deriving that at render time — rather
than remembering "the selection was excluded" — is what keeps it correct when the
filter changes again.

---

## Persistence shape

The one persisted value, in browser-local storage:

```
sdlc.workbench.listCollapsed = "true" | "false"
```

Three rules, each of which is a failure mode the spec cares about:

1. **Absent means expanded.** A first run shows the list, because a workbench that
   opens with its primary pane hidden is not discoverable.
2. **Unreadable means expanded.** Storage can be unavailable or throw; the read is
   defensive, and its failure resolves to the state in which nothing is hidden.
3. **It is never read by anything but the shell.** No pane, and nothing in
   `src/core`, `src/providers` or `src/main`, knows this value exists.

---

## What is deliberately not added

- **No "last selected item".** The URL already holds the selection, and a second
  copy would diverge the moment someone opened a link.
- **No layout state in the main process.** It would need a new bridge method and a
  new persisted file, widening the renderer's privilege set for a boolean about a
  sidebar (ipc-surface.md §4).
- **No pane widths.** FR-003 fixes the shape; a draggable splitter is a separate
  judgement and is not in this spec.
- **No change to `WorkItem`, `WorkItemSummary`, `Repository`, or any wire schema.**
  If this feature ends up touching one of those types, something has gone wrong:
  it is a re-arrangement of the interface, and the data beneath it is finished.
