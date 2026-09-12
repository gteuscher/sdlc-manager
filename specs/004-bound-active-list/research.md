# Phase 0 Research: Bounding the Active List

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-09-12

Every decision below is checked against constitution v2.1.0. Two constraints bind
this feature: Principle XII (**8.94 KB** of initial-JS headroom after 003) and
Principle II, which this is the first feature to add a rule *about* rather than
merely obey.

---

## 1. Why the escape hatch is unreachable, which is not where it looks

**Finding**: the terminal exclusion is applied in the wrong layer for the way the
renderer is built, and that — not a missing control — is why finished work cannot
be reached.

`src/main/ipc/items.ts` excludes terminal items unless a `stateId` is named:

```ts
if (filter.stateId === undefined && isTerminal(repository.definition, entry)) return false;
```

Meanwhile 001's `Items.tsx` deliberately **asks for everything and narrows
locally**, and its own docblock says why: "the filter options themselves are
derived from the items — ask for a filtered list and the option sets collapse to
whatever survived the last filter, so a repository could never be selected back."

Those two decisions are individually sound and jointly broken. The renderer asks
with no filter, believing it is getting everything; the main process quietly
withholds the finished items; the renderer then builds its state options from what
arrived. A terminal state can therefore never appear as an option, so the
`stateId` escape can never be exercised from the interface. **The hatch is real,
and nothing can reach the handle.**

Worth stating plainly because it changes what "add a control" means: this is a
layering defect, not a missing feature. Whatever the interface gains, the fix has
to put the "is this item finished" question somewhere the renderer can answer.

---

## 2. How the renderer asks for finished work

**Decision**: add `includeTerminal?: boolean` to the item filter on the wire.
Absent or false keeps today's behaviour; true returns finished work too.

**Rationale**: the default path stays **bounded**, which is the whole point of the
feature. Finished work only accumulates — a repository three years old has far
more finished items than active ones — and a design that shipped all of them on
every reconciliation in order to hide them in the renderer would re-create the
unbounded problem one layer further in, while paying for it on every refresh.

It also keeps the honest property that the request says what it wants. The main
process is the only component that can answer "is this state terminal" for an
arbitrary repository, because it is the only one holding the loaded definitions.

**Alternatives considered**:

- *Send everything always and let the renderer decide.* Tempting, because it
  restores 001's "ask for everything, narrow locally" symmetry and would make the
  toggle purely local with no refetch. Rejected on payload: unbounded by
  construction, and worst exactly where the product is most used.
- *Keep only the existing `stateId` escape and populate options from the loaded
  definitions instead of from the items.* Would work, and is arguably the purest
  fix to §1 — but it makes "show me everything finished" an act of selecting each
  terminal state in turn, one repository's vocabulary at a time. That is not the
  question an engineer is asking.
- *A separate `listFinishedItems` channel.* A second channel returning the same
  shape, differing by one boolean. Principle VII: one parameter is cheaper than
  one channel.

**Consequence worth recording**: `queryKeys.items(filter)` includes the filter, so
the active list and the with-finished list are two cache entries. `CollapsedRail`
calls `useItems()` with no filter and should keep doing so — attention is never
raised on a terminal state (`attention.ts:30`), so the collapsed rail's count is
identical either way, and it should stay on the bounded query. The cost is one
extra round trip while finished work is on screen, which is the moment the
engineer has explicitly asked for more data.

---

## 3. How the renderer knows *which* items are finished

**Decision**: add `terminal: boolean` to `WorkItemSummary` — "the state this item
rests in is declared terminal by its repository's definition".

**Rationale**: FR-003 requires a finished item to be visibly distinguishable and to
name the state it finished in. With finished and active items in one list, the
renderer cannot tell them apart: it has the item's `stateId` and `stateName`, and
no way to know what those mean, because it does not hold the definition and must
not learn any state's name (FR-020, Principle II).

This is derived on every projection in `toSummary`, never stored. An item that
leaves a terminal state carries `terminal: false` on the next reconciliation with
nothing to invalidate — which is FR-017 for free, and the reason data-model.md
insists this is derived rather than recorded.

**Alternatives considered**:

- *Let the renderer compare `stateId` against a list of terminal ids fetched
  separately.* Puts lifecycle interpretation in the renderer and needs a second
  request keyed by repository. Worse on both principles it touches.
- *Infer it from `progress === 'completed'` on the summary.* Summaries carry no
  progress, and completed is not the same claim as terminal — an item can have
  completed a state without the lifecycle being over.

**Cost, named up front**: `WorkItemSummary` is constructed by three test files —
`tests/component/ItemList.test.tsx`, `tests/component/Workbench.test.tsx` and
`tests/unit/cache.rebuild.test.ts`. Each has a single fixture helper, so this is
three one-line edits. **This feature therefore edits 001's `ItemList` suite**,
which 003 deliberately did not. That was 003's measurement device for a
re-arrangement, not a standing prohibition; a feature that genuinely adds a field
to a wire type is expected to touch the fixtures that construct it. It is recorded
here so the edit is not later misread as a regression.

---

## 4. Where "this lifecycle never releases work" is reported

**Decision**: `SdlcPackageSummary` gains `terminalStateCount: number`, derived from
the loaded definition beside the `stateCount` it already carries. The repositories
view interprets it. **It is not a validation rule.**

**Rationale**: the spec's Assumptions settled that this is reported rather than
rejected. Phase 0 found that it *cannot* be a validation rule even if that had
been the choice: `validateManifest` returns `ManifestProblem[]`, its docblock
states "validation is all-or-nothing — a manifest failing any rule is never
partially loaded", and there is **no warning severity anywhere in the manifest
pipeline**. Adding one would mean a severity field on `ManifestProblem`, a
migration for every consumer of it, and a change to the published manifest
contract — a large change to carry a condition that is not an error.

The package summary is already the place the repositories view learns
package-level facts, and it already carries `stateCount`, `supported`, `problem`,
`problemField` and `problemLine`. One more number sits naturally beside them.

**A number rather than a boolean, deliberately.** `terminalStateCount` answers both
conditions the spec requires with one field:

| Condition | Test | Requirement |
|---|---|---|
| Never releases work | `terminalStateCount === 0` | FR-010, FR-011 |
| Finishes work instantly | `terminalStateCount === stateCount` | FR-014 |

A boolean would have answered the first and needed a second field for the mirror
case. Neither test names a state, so Principle II holds and the renderer lint rule
is unaffected.

**Alternatives considered**:

- *A new validation rule 16.* Would make every existing package invalid until
  audited, contradicts the spec's report-not-reject decision, and is impossible
  without inventing a warning channel first.
- *`Repository.problem`.* Wrong cardinality: the condition belongs to a package,
  and every repository following that package would repeat the same message.
- *A dedicated `packageWarnings` channel.* A channel for one derived integer.

---

## 5. Saying what is withheld, without inventing a count

**Decision**: the control itself is the conveyance. No finished-item count crosses
the wire, and the list claims only that finished work is **not shown** — never
that any exists.

**Rationale**: the first draft of FR-002 asked the list to convey that finished
work *exists* and is not shown. This section is what showed that to be
unsatisfiable, and the requirement was amended rather than the design bent to fit
it: the renderer cannot know whether any finished work exists without fetching the
very thing it is withholding, so a control promising it would be lying in every
repository that has none.

The instinct is a number — "12 finished items hidden" — and the instinct is
wrong here, because the renderer cannot know that number without either fetching
the finished items it is trying not to fetch, or changing `listItemsReplySchema`
from an array to an object carrying a count.

That second option is what tipped it: the reply shape is an array today, and
wrapping it touches the schema, `bridge.ts`, `hooks.ts`, `createBridgeStub`, and
every component test that stubs a list — a wide blast radius for a number that is
only reassurance. A persistently visible control labelled for what it does says
the same thing and cannot be wrong.

**Where the count *is* honest**: once finished work is included, the renderer holds
the items and knows exactly how many are finished. Reporting it then costs nothing
and claims nothing it cannot prove (Principle X).

**Alternatives considered**: *a count in the reply* (above); *an approximate or
cached count* — a number that can be stale is worse than no number, and this
product's whole posture is that a wrong count tells an engineer to stop looking.

---

## 6. Where the flag lives

**Decision**: the URL query, as `?finished=1`. Not local storage, not a store.

**Rationale**: 003 drew the line and this feature follows it — **the URL holds what
another person or another session should be able to arrive at; local storage holds
what only this engineer at this desk cares about.** "I am looking at the release we
just finished" is exactly the first kind: it is worth sharing and worth
bookmarking, which is FR-007 and User Story 3.

It is a filter, and every other filter in this product is already a query
parameter. Putting this one somewhere else would be the exception that starts
eroding the rule 003 established.

`finished` collides with nothing: the list owns `repository`, `sdlc`, `state` and
`q`; the detail owns `tab`. And the collision lesson from 003 applies directly —
this is a **fifth key owned by the list**, so it joins the set `setFilter` and
`clearFilter` delete and rewrite, and must not be clobbered by the detail or
clobber it.

**Alternatives considered**: *a browser-local preference like the pane collapse* —
rejected because collapse describes furniture and this describes what the list is
showing; *no persistence* — fails FR-007 and Story 3.

---

## 7. Bundle budget

Against Principle XII's 150 KB initial-JS budget, with **141.06 KB spent**:

| Addition | Estimated gzip |
|---|---:|
| The finished control and its URL plumbing in `Items.tsx` | ~0.4 KB |
| Finished marking on the row, and the new empty-state branch | ~0.3 KB |
| Package condition reporting in `Repositories.tsx` | ~0.3 KB (lazy route, not initial) |
| **Projected initial JS total** | **~141.8 KB** |

Roughly **8.2 KB** of headroom would remain. The repositories view is behind its
own lazy boundary, so its share does not land in the initial bundle.

**If the budget fails**: trim, or move `Items` behind a lazy boundary as 003's
research already proposed. Not raise the number — that is a PATCH amendment
needing its own justification.

---

## 8. Scale

**Decision**: no pagination, no time bound. Measure it instead.

**Rationale**: SC-007 asks that with 200+ items **and finished work included**,
identifying what needs the engineer still takes under ten seconds. Attention-first
ordering does most of the work here: a terminal state never raises attention
(`attention.ts:30`), so every finished item sorts *below* every item needing
input, no matter how many there are.

That is a genuinely reassuring property and worth stating: including finished work
lengthens the list downward, away from the thing the engineer is looking for. The
smoke suite already measures the 220-item case with both panes rendered (003's
T043); this feature extends it rather than inventing a new measurement.

The spec's Assumptions record why a time bound was rejected — when an item finished
is known only for transitions this application observed, so a time-bounded list
would silently omit anything already finished when its repository was registered.

**Alternatives considered**: *paginate the finished list* — a second interaction
model for the same list, and Principle VII's "inline until it hurts" says wait
until it hurts; *cap it at N most recent* — needs the same finish time that does
not reliably exist.
