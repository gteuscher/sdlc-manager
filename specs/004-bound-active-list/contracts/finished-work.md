# Contract: Finished Work

**Status**: Draft · **Created**: 2026-09-12 · **Feature**: [spec.md](../spec.md)
**Satisfies**: FR-001 – FR-020, Constitution Principles II, VI, IX, X, XI, XIII

What "finished" means, who decides it, what crosses the IPC boundary to say so,
and what the interface must do with it. Written as a contract because these are
the properties the tests assert, and because the central rule — that no component
may decide for itself whether an item is finished — is one a reasonable change
could break without noticing.

Extends [001's ipc-surface.md](../../001-sdlc-work-item-dashboard/contracts/ipc-surface.md)
and [001's sdlc-manifest.md](../../001-sdlc-work-item-dashboard/contracts/sdlc-manifest.md).
Neither is amended: this contract adds fields to existing shapes and no rule to
the manifest format.

---

## 1. The definition of finished

> An item is **finished** when the repository's own loaded SDLC definition declares
> the state that item currently rests in as `terminal`.

That is the whole of it, and every clause matters:

- **The repository's own definition.** Two repositories on different lifecycles
  answer differently for the same recorded value, and both are right.
- **Currently rests in.** Finishedness is a property of where the item is now, not
  of anything it has done. An item that moves out of a terminal state is not
  finished any more, with nothing to invalidate.
- **Declares.** Read from the manifest, never inferred from a state's name, its
  ordinal, its position last in the list, or whether every gate passed.

**Only the main process may evaluate this**, because it is the only process
holding the loaded definitions. The renderer is *told*; it never decides.

### When it cannot be answered

| Situation | `terminal` | Why |
|---|---|---|
| The item's recorded state is unmapped | `false` | There is no declared state to ask about. The item stays visible so it can be seen and fixed (FR-015). |
| The repository's definition failed to load | `false` | Nothing is knowable about any of its items, and the answer that hides work is the wrong guess (FR-016). |

Both resolve to "not finished" — the state in which nothing disappears. This
mirrors 003's rule for an unreadable preference and 001's rule for an unmapped
state: **when the application cannot prove something, it does not act as though it
had** (Principle X).

## 2. The wire

Three additions to existing shapes, all validated by their existing schemas in
both directions (Principle IX). No new channel.

### Request — `ItemFilter`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `includeTerminal` | `boolean?` | absent = `false` | Include finished work in the reply |

The existing rule that naming a `stateId` also returns terminal items in that
state is retained unchanged.

### Reply — `WorkItemSummary`

| Field | Type | Meaning |
|---|---|---|
| `terminal` | `boolean` | The state this item rests in is declared terminal |

Required, not optional. A summary that could omit it would push the "unknown means
not finished" decision out to every consumer, and §1 places that decision in one
process on purpose.

### Reply — `SdlcPackageSummary`

| Field | Type | Meaning |
|---|---|---|
| `terminalStateCount` | `number` | How many of this package's states are declared terminal |

A count, not a verdict. The view decides what to say about it (§4); the engine
does not decide what an engineer should be told.

## 3. The list

1. Finished work is **excluded by default** (FR-001). A caller that says nothing
   gets today's behaviour, and an engineer who has never heard of this feature
   gets a bounded list.
2. The control to include it is **persistently visible**, not hidden behind a
   menu — it is the only thing telling an engineer that the list is withholding
   anything (FR-002). It says finished work is **not shown**; it does not say any
   exists, because that is unknowable until it is fetched, and §5 explains why no
   count sits beside it. The distinction is small and load-bearing: a control that
   promised finished work would be lying in every repository that has none.
3. When included, each finished item is distinguishable **without relying on
   colour** and names the state it finished in, as that state's own lifecycle
   names it (FR-003).
4. Every existing filter and the search narrow finished work exactly as they narrow
   active work (FR-006). Finished work is not a separate list; it is more of the
   same list.
5. Including or excluding finished work **does not change what the detail pane is
   showing** (FR-005). This is the same rule 003's FR-014 states for filtering, and
   it applies for the same reason.
6. Attention ordering is unaffected: a terminal state never raises an attention
   signal, so finished items sort below everything that needs the engineer. The
   list grows downward, away from what is being looked for.

## 4. Reporting a lifecycle that never releases work

Interpreted in the view that shows packages, from `terminalStateCount`:

| Condition | Reported | Requirement |
|---|---|---|
| `terminalStateCount === 0` | This lifecycle declares no final state, so its items never leave the active list | FR-010, FR-011 |
| `terminalStateCount === stateCount` | Every state is final, so its items never appear as active | FR-014 |

Four rules govern the report:

1. It **names the package**, since the condition belongs to a package and every
   repository following it is equally affected.
2. It says the correction belongs **in the package**, not in this application
   (FR-011). Nothing here can fix a manifest, and offering to would be a lie.
3. It is **not an error and not a refusal.** The package still loads, the
   repository still registers, and its items are still discovered, reconciled,
   listed and openable (FR-012). This follows 001's FR-045, which reports an
   unsupported package rather than failing — **this product reports rather than
   refuses.**
4. It **clears itself** when the package is corrected, with no action in this
   application beyond the next reconciliation (FR-013), because the count is
   derived and never stored.

Neither condition names a state, so the lint rule forbidding lifecycle vocabulary
in engine and UI modules continues to apply unchanged (FR-020, Principle II).

## 5. What this contract does not govern

- **A count of hidden finished items.** There is none on the wire, deliberately —
  [research.md §5](../research.md). Once finished work is shown the renderer holds
  the items and may count what it can see; before that it may not claim a number
  it would have to fetch or guess.
- **When an item finished.** Not modelled. The transition log records when this
  application *observed* a change, which is not the same thing and does not exist
  for an item already finished when its repository was registered.
- **Ordering, spacing, and how a finished row is marked.** Design decisions, so
  long as §3.3 holds.
- **Where the control sits in the list pane.** Design, within
  [003's workbench-layout contract](../../003-two-pane-workbench/contracts/workbench-layout.md).
- **Any way to remove, hide, dismiss or snooze an item.** Out of scope and
  forbidden by FR-021; the spec records why it must not come first.
