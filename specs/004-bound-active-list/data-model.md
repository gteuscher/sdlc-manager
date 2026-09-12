# Phase 1 Data Model: Bounding the Active List

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-12

This feature adds **no domain data and no persisted state**. Every value below is
either derived on each read from a definition already loaded, or a view preference
already carried in the URL.

That is the property worth pinning down, because "which items are finished" is
exactly the kind of thing that looks like it wants a column. It must not have one:
finishedness is a *question asked of the lifecycle*, and the moment it is recorded
anywhere it can disagree with the definition that owns it (Principle VI).

---

## What changes on the wire

Three fields, in three existing shapes. No new channel, no new entity.

| Shape | Field | Type | Meaning |
|---|---|---|---|
| `ItemFilter` (request) | `includeTerminal` | `boolean` (optional) | Return work the lifecycle considers finished as well. Absent means no. |
| `WorkItemSummary` (reply) | `terminal` | `boolean` | The state **this item rests in** is declared terminal by this repository's definition. |
| `SdlcPackageSummary` (reply) | `terminalStateCount` | `number` | How many of this package's states are declared terminal. |

All three cross the IPC boundary and are therefore validated by their existing zod
schemas on the way out and the way in (Principle IX). None of them is new
vocabulary: `terminal` is already a manifest field the engine reads.

### `includeTerminal` — the request

Absent, `false`: today's behaviour exactly, so every existing caller is unchanged.
`true`: finished items are included alongside active ones.

The existing rule that naming a `stateId` also brings terminal items back is
**retained**, not replaced. It costs nothing, it is already relied on by the
projection path, and removing it would be a behaviour change this feature has no
reason to make.

### `terminal` — the reply

Derived in the item projection from the repository's own loaded definition. Three
rules, each of which is a failure mode the spec names:

1. **Unknowable means not finished.** An item whose recorded state is unmapped has
   no state in the definition to ask about, so it is never `terminal` (FR-015).
   This is the existing behaviour of `isTerminal` and must survive.
2. **A missing definition means not finished.** A repository whose package could
   not be loaded cannot answer the question for any of its items, and the honest
   answer is the one that keeps the work visible (FR-016).
3. **It is recomputed every time.** Nothing caches it, so an item reopened in its
   system of record simply stops being terminal (FR-017).

### `terminalStateCount` — the package

Counted from the loaded definition beside the `stateCount` already reported. It is
a **fact**, not a verdict; the interpretation belongs to the view:

| `terminalStateCount` | What the repositories view says |
|---|---|
| `0` | This lifecycle declares no final state, so its items never leave the active list (FR-010, FR-011) |
| `=== stateCount` | Every state is final, so its items never appear as active (FR-014) |
| otherwise | nothing |

Keeping the number rather than a verdict is what lets one field answer both
conditions, and what keeps the engine from deciding what an engineer should be
told.

---

## Derived, never stored

| Value | Derived from | Why it must not be stored |
|---|---|---|
| Whether an item is finished | its state id, against its repository's definition | A stored copy disagrees with the definition the moment a package is upgraded, and the item would be filed under a state that no longer exists. |
| Whether a lifecycle releases work | the count of terminal states in the definition | Same reason, one level up: correcting the manifest must fix the report with no other action (FR-013). |
| Whether finished work is currently shown | the URL | See below. |

**Nothing about finishing is written to any system of record.** The application
does not close, transition or reopen anything (FR-019). An item becomes finished
because its system of record says so and its lifecycle declares that state final —
two facts this application reads and neither of which it authors.

---

## View state

One value, and it goes where 003 put its kind:

| Value | Home | Why there |
|---|---|---|
| Finished work included | **URL query** — `?finished=1` | Worth sharing and worth returning to (FR-007, Story 3). "The release we just finished" is a view a colleague should be able to be sent. |

Absent means excluded — the quieter default, and the one that keeps the list
bounded for someone who has never heard of this feature.

This is the **fifth key the list pane owns**, joining `repository`, `sdlc`, `state`
and `q`. 003 ended with a defect in exactly this area: the list rebuilt the whole
query string when writing a filter and erased the detail pane's `tab`. The fix
deletes and rewrites only the list's own keys, so **this key must be added to that
set** — otherwise it survives a filter change by accident today and breaks the
first time someone reorders the code.

---

## What is deliberately not added

- **No count of hidden finished items on the wire.** The renderer would have to
  fetch what it is trying not to fetch, or the reply would have to stop being an
  array. [research.md §5](research.md) records the reasoning; the visible control
  conveys the same thing and cannot be wrong.
- **No "finished at" timestamp.** The transition log records when this application
  *observed* a transition, which is not when the work finished and does not exist
  at all for an item already finished when its repository was registered. A field
  that is right for some items and silently absent for others is worse than no
  field.
- **No terminal flag on `StateView`.** It is already there — `StateView.terminal`
  has existed since 001 and the detail pane already renders "Final state" from it.
  This feature adds the same fact to the *summary*, where the list needs it.
- **No change to `WorkItem`, `Repository`, the transition log, or any provider.**
  If this feature ends up touching a provider, something has gone wrong: every
  provider already reports the state an item rests in, and what that state *means*
  is the manifest's business.
