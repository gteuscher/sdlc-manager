# FR-021 Baseline: Two-Pane Workbench

**Recorded**: 2026-09-12, before any file in this feature was touched (T001, T002)
**Feature**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)

This file exists because the failure mode for this feature is **quiet loss**, not
visible breakage. A dropped attention marker or a missing raw value makes the
interface look tidier, not broken, and review will not catch it. The numbers below
are what "nothing was lost" is measured against.

---

## 1. Test suite, before (T001)

`npx vitest run` — **31 files, 630 tests, all passing.**

| Suite | Tests | Note |
|---|---:|---|
| `tests/component/ItemList.test.tsx` | 15 | FR-021 net — must pass **unedited** |
| `tests/component/StateTabs.test.tsx` | 10 | FR-021 net — **one line** may change (T004) |
| `tests/component/GateList.test.tsx` | 8 | FR-021 net — must pass **unedited** |
| `tests/component/ArtifactPanel.test.tsx` | 8 | FR-021 net — must pass **unedited** |
| `tests/component/Markdown.safety.test.tsx` | 4 | FR-021 net — must pass **unedited** |
| `tests/component/Console.test.tsx` | 10 | FR-021 net — must pass **unedited** |
| `tests/component/Repositories.test.tsx` | 23 | FR-022 — untouched view |
| `tests/component/RouteErrorBoundary.test.tsx` | 9 | reused by FR-019 |
| `tests/unit/**` (21 files) | 496 | no task in this feature touches their subjects |
| `tests/parity/engine.parity.test.ts` | 47 | ditto |

### One pre-existing flake, recorded so it is not later blamed on this feature

On the first full-suite run, `StateTabs.test.tsx › moves between tabs with the
arrow keys` failed with `expected 'CurrentWeaving' to contain 'Proofing'`. The
`document.activeElement` assertion one line above it **passed** — focus had moved,
selection had not yet caught up.

It did not reproduce: the suite passed in isolation twice, and the full suite
passed 630/630 on the immediately following run with no source change. It is a
timing race between Radix's activate-on-focus and the assertion, visible only when
the runner is loaded. **It exists on `main` today, before this feature.** If it
recurs after the workbench lands, that is the same flake and not a regression —
but a *reproducible* failure in this suite is a finding.

## 2. Bundle, before (T002)

`npm run build && npx size-limit`

| Budget | Limit | Before | Headroom |
|---|---:|---:|---:|
| Initial JS (gzip) | 150 KB | **139.45 KB** | 10.55 KB |
| Lazy route: markdown artifact (gzip) | 60 KB | 49.66 KB | 10.34 KB |
| Total application JS (gzip) | 400 KB | 189.1 KB | 210.9 KB |
| Initial CSS (gzip) | 20 KB | 5.45 KB | 14.55 KB |

Emitted chunks:

```
assets/index.js             385.82 kB │ gzip: 115.95 kB
assets/ItemDetail.js         55.23 kB │ gzip:  17.04 kB   ← lazy boundary
assets/Repositories.js       23.08 kB │ gzip:   6.72 kB   ← lazy boundary
assets/MarkdownArtifact.js  162.80 kB │ gzip:  49.73 kB   ← excluded from initial
assets/index.css              7.10 kB
assets/ItemDetail.css        10.90 kB
assets/Repositories.css       6.25 kB
```

**`MarkdownArtifact*.js` is confirmed a separate, separately-named chunk**, which
is what `.size-limit.json` excludes from the initial budget by name. A later
regression in that boundary is therefore attributable: if `react-markdown` ends up
in `index.js`, the initial figure jumps by ~50 KB and blows the budget outright
rather than degrading quietly.

Worth naming, because it is easy to misread the config: the initial-JS budget
counts `ItemDetail.js` and `Repositories.js` **too** — only `MarkdownArtifact*.js`
is excluded. The lazy boundary that Principle XII actually depends on is the one
inside `ItemDetail.tsx`, not the one in `App.tsx`.

Against the ~141.2 KB projection in [research.md §7](research.md), the ~10.55 KB
of real headroom leaves ~8.8 KB of margin after this feature.

---

## 3. Results, after

*Filled in by T040, T041, T042 and T045.*

### T040 — the 001 suites still pass, unedited

**Result: the claim holds, and the exception was three tokens rather than one.**

`npx vitest run` — **33 files, 660 tests, all passing**, run three times consecutively
with no failure. That is 630 before plus 30 new: 17 in `Workbench.test.tsx` (16 for
the tasks, plus the W6 regression test added after validation found the defect
recorded under T042) and 13 in `usePaneState.test.tsx`.

`git diff --stat` over the six suites named as the FR-021 regression net:

| Suite | Diff | Verdict |
|---|---|---|
| `ItemList.test.tsx` | **none** | passes unedited |
| `GateList.test.tsx` | **none** | passes unedited |
| `ArtifactPanel.test.tsx` | **none** | passes unedited |
| `Markdown.safety.test.tsx` | **none** | passes unedited |
| `Console.test.tsx` | **none** | passes unedited |
| `StateTabs.test.tsx` | 3 lines, 3 tokens | the T004 exception |

Also unedited, though not part of the named net: `Repositories.test.tsx` (23) and
`RouteErrorBoundary.test.tsx` (9).

**The one finding, reported rather than absorbed.** T004 predicted a **one-line**
change and said that anything larger meant the test was coupled to something it
should not be. It was three lines:

```
-    expect(screen.getByTestId('query-string').textContent).toContain('state=clearing');
+    expect(screen.getByTestId('query-string').textContent).toContain('tab=clearing');
-    mount(stubFor(fourthOfSix()), '/items/LED-42?state=dispatch');
+    mount(stubFor(fourthOfSix()), '/items/LED-42?tab=dispatch');
-    mount(stub, '/items/LED-42?state=proofing');
+    mount(stub, '/items/LED-42?tab=proofing');
```

**This is not the coupling T004 was watching for.** The three are the same
parameter appearing once as a write the suite asserts and twice as a read the
suite supplies — a rename of one URL key touches every place that key is spelled,
and three is simply how many times a well-written suite spells it. The test that
would have signalled coupling is one where the change had to reach *structure*:
a new prop, a new wrapper, a mock of something the pane should not know about.
None was needed. The prediction was off by two occurrences; the property it was
protecting held.

**Why no other suite needed touching**, stated because it is the actual measurement
and not a happy accident: both parameters the panes gained — `Items`' `selectedKey`
and `ItemRow`'s `selected` — are **optional and default to the pre-003 behaviour**.
A list mounted alone renders exactly what it rendered before. That is what let the
regression net stay a net instead of becoming part of the change under test.

**Note on the pre-existing flake.** It recurred exactly once during this feature's
work, in a subagent's first full-suite run, with the identical signature recorded
in §1 — and did not reproduce in any of the six full runs since. Same flake, same
cause, unrelated to this feature.

### T041 — 001's quickstart V1–V5 (SC-004)

**Result: all five pass against the workbench. Nothing from 001 was lost.**

Walked against a **built** application — two fixture repositories on two different
lifecycles, driven through Playwright rather than asserted from memory, because
the whole point of this task is that the losses this feature risks are the ones a
reader talks themselves into believing did not happen.

| Scenario | Verdict | What was actually observed |
|---|---|---|
| **V1** every active item, attention first | **PASS** | 12 rows, each carrying key, title, SDLC, repository, state and a `<time>`. The six marked rows occupy positions 0–5 — every one of them ahead of every unmarked row. The two markers differ three ways: class (`badge--input` / `badge--gate`), wording ("Awaiting your input" / "Gate failed") and drawn shape (circle+`?` / triangle+`!`), so they stay distinguishable in greyscale. The count read "6 items need your attention." against exactly 6 marked rows. |
| **V2** two lifecycles in one list | **PASS** | 7 `DEMO-*` rows on "Fixture Standard SDLC" (Specification/Design/Implementation/Review/Release) beside 5 `LAB-*` rows on "Lab Research Pipeline" (Intake/Protocol/Analysis), in one pane, with **zero state-name overlap** and all 8 state names offered by the filter. No application change was needed for the second lifecycle — SC-003's central claim, still true in a rail. |
| **V3** following one item through its states | **PASS** | Six tabs in ordinal order with the **fourth** selected. First three "Completed", last two "Not reached". Gates across the item's tabs produced Passed, **Failed** and **Not evaluated** as three distinct values — no gate without a recorded result displayed as passed (FR-014, SC-005). Selecting a tab moved the URL to `?tab=…`, and arriving at `?tab=release` opened Release directly. |
| **V4** artifacts and their provenance | **PASS** | Markdown rendered with its locator `docs/items/DEMO-105/review.md` and a reconciled `<time>`. After the file was deleted and the view refreshed: exactly one `.artifact--failed` carrying `role="alert"`, the message "…does not exist.", an `Unavailable` tag and a retry — **in place**, while Gates, Console, Artifacts and all six tabs still rendered around it (FR-019). |
| **V5** repositories and configuration | **PASS** | Two groups, each headed by its SDLC name and showing package **and version**. An undeclared key was rejected naming `field: "not.a.setting"`; a wrong type was rejected with `"Repository root" must be text; a number was supplied.` The prior configuration was retained — `listRepositories()` was byte-identical before and after — and the rejection rendered against the offending input with "The previous configuration is still in effect for demo2." |

**Two things found while walking these, neither caused by 003, both recorded so
they are not lost:**

1. **A `field`-kind gate with no recorded value renders "Failed", not "Not
   evaluated"** (`src/providers/filesystem/index.ts`), which contradicts the
   fixture generator's own inline comment ("Absent means not_evaluated") and the
   `unevaluated` role it seeds. `manual` and `check` gates behave correctly. V3's
   claim still holds because a genuine "Not evaluated" is present on another tab,
   so this is a **001 provider defect, not a 003 regression** — and this feature
   is explicitly forbidden from touching `src/providers`, so it is reported here
   rather than fixed. Worth a task of its own.
2. **V5 is not walkable with the stock fixtures.** Neither `--sdlc default` nor
   `--sdlc alt` declares a `repo_config` field that can hold an invalid value —
   both declare only optional strings — so the rejection path V5 asks for cannot
   be reached by `npm run fixture:create` alone. It was reached here by patching
   a manifest in a temp directory. 001's quickstart should either say so or the
   generator should seed a required field.

### T042 — this feature's quickstart W1–W12 (SC-002, SC-006)

**Result: eleven pass. W6 failed, exposing a real defect, which is fixed and now
has a regression test with a negative control.**

| Scenario | Verdict | What was actually observed |
|---|---|---|
| **W1** both at once | **PASS** | Selecting an item left rows at 12→12 and the marked-key list identical: `badge--input` 2→2, `badge--gate` 4→4. One `li.row--selected[aria-current="true"]` carrying the word "Reading". Nothing was dimmed or hidden while the detail was open. |
| **W2** one interaction to the next item | **PASS** | One click on a row link changed `.detail__key`; the list stayed mounted at 12 rows. **SC-002 observation**: one interaction, no intermediate step back to a list. |
| **W3** nothing selected | **PASS** | `.no-selection` with a real heading and 264 characters of body plus a 137-character hint. **Zero** `.pending` elements in the detail pane — a deliberate nothing, not a spinner (Principle X). |
| **W4** collapsing | **PASS** | Detail width 926.4px → 1211.0px. `.workbench__list-body` carried `hidden`; the collapsed rail still read "6 items need your attention." (FR-009); the toggle stayed visible at `aria-expanded="false"`; expanding restored the same selection, still open. Restart persistence is separately proven across two processes by `tests/smoke/workbench.spec.ts`. |
| **W5** filtering does not disturb the work | **PASS** | A filter narrowed 12 rows to 1, excluding the open item. `.items__excluded` appeared; the detail still showed the excluded item; clearing restored 12 rows with the selection intact. |
| **W6** the parameter collision | **FAIL, then fixed** | See below. |
| **W7** returning directly | **PASS** | `#/items/DEMO-104?state=review&q=Correct&tab=design` survived a reload byte-identical: state select, search box, one-row list, open item and open tab all restored. |
| **W8** narrow window | **PASS, with an observation** | At `data-narrow="true"`: exactly 1 pane, 0 of the other, occupying 867.2 of 867px — not squeezed, genuinely absent from the accessibility tree rather than painted out. The back control returned to the list; widening restored both. |
| **W9** independent failure | **PASS** | A deleted artifact produced an in-place failure with a retry while its sibling artifact still rendered, and **the list kept working** — another item was selected with no reload. |
| **W10** nothing was lost | **PASS** | V1–V5 all pass against the workbench (see T041). The 003 defect found was W6, which is a *new* collision rather than a lost 001 behaviour. |
| **W11** scale | **PASS** | `tests/smoke/scale.spec.ts` 6/6, including the new T043 measurement: 200+ rows **with a detail open**, attention state still reachable and self-consistent inside the budget. |
| **W12** keyboard only | **PASS** | Tab order: toggle → repository → SDLC → state → search → row links → "← All work items" → tabs. Enter on a row link opened the item and **`document.activeElement` was still the row link inside the list pane** — selection does not steal focus, which contract §3.3 requires and which would have made the list unusable by keyboard. Arrow keys moved between tabs and updated the URL. The toggle was operable by Enter in both states. **SC-006 observation: the whole walkthrough completed without the mouse.** |

#### W6 — the defect this scenario exists to catch, and it caught it

**What failed.** Changing the tab left the filter alone. Changing the *filter*
destroyed the *tab*:

| action | URL before | URL after | open tab |
|---|---|---|---|
| state select | `?state=review&tab=build` | `?state=spec` | jumped back to Review |
| **one keystroke** in Search | `?tab=release` | `?q=Corr` | jumped back to Review |
| "Clear filters" | `?state=review&tab=release` | *(no query at all)* | jumped back to Review |

**Root cause.** `setFilter` and `clearFilter` in `Items.tsx` built a **fresh**
`URLSearchParams` and replaced the whole query string, discarding every key the
list does not own. `git diff` confirms 003 had not touched either function: this
was correct while the list was a page that owned its URL, and became wrong the
moment it became a pane sharing one URL with the detail.

**Why the planned work missed it.** research.md §2 diagnosed the collision as one
thing and fixed it in one place — renaming the detail's parameter. But the two
directions fail through **different code**: the rename stopped the tab from
filtering the list and did nothing about the list erasing the tab. T030's test
("filtering changes the list and not the detail") passed throughout, because the
detail kept showing the same *item* — only its tab silently reverted. It is
exactly the shape of loss this feature's tasks.md warned about: it looks like
nothing happened.

**Fix.** `Items.tsx` now copies the existing query string, deletes only its own
four keys, and writes back the ones that survive. One helper, both call sites.

**Regression test, with a negative control.** `Workbench.test.tsx` gained
"lets the filter and the open item's tab share one URL without either erasing the
other", which asserts **both** directions and exercises **all three** of the
list's write paths — the select, a keystroke in the search field, and the clear
button — because the select is the obvious one to check and the keystroke is the
one an engineer hits first. Reverting the one-line fix makes it fail
(`expected '/items/FDY-2?repository=repo-foundry&…' to contain 'tab=smelting'`);
restoring it makes it pass. The test is not vacuous.

#### Observations a machine could not make, recorded rather than claimed

- **Is a 340px list column comfortably readable beside a 926px detail?** Measured,
  not judged. Two panes at 1280 wide are 340 + 926; one pane narrow is 867. That
  they are not *squeezed* is proven; that they are *pleasant* is not.
- **`minWidth` is 880 (`src/main/window.ts`) against a 899px threshold.** The
  single-pane arrangement is therefore reachable only in roughly a 32px band at
  the very bottom of the allowed window size. It works, and arguably "one pane at
  the smallest window the application permits" is the right behaviour — but the
  two numbers were chosen independently and should be reconciled deliberately
  rather than by coincidence. Changing either is out of this feature's scope
  (`src/main` is off-limits here, and moving the threshold needs evidence).
- **Scroll retention across a selection on a *scrolled* list** was not observed:
  twelve items never scrolled. The collapse/expand restore has its own test; this
  one still wants a human with a long list.
- **A visible focus indicator** was not verified — only the tab order and
  operability. `:focus-visible` is styled on every interactive element, but its
  contrast was not measured.
- **"Under ten seconds" for a human read** (V1, W11) remains unmeasurable. What is
  measured is everything that would make it impossible.

### T045 — bundle, after

**Result: pass, within 0.16 KB of the projection. The budget was not raised.**

| Budget | Limit | Before | After | Change |
|---|---:|---:|---:|---:|
| **Initial JS (gzip)** | 150 KB | 139.45 KB | **141.06 KB** | **+1.61 KB** |
| Lazy route: markdown artifact | 60 KB | 49.66 KB | 49.66 KB | **unchanged** |
| Total application JS | 400 KB | 189.1 KB | 190.72 KB | +1.62 KB |
| Initial CSS | 20 KB | 5.45 KB | 5.89 KB | +0.44 KB |

research.md §7 projected **~141.2 KB**. The actual figure is **141.06 KB** — the
estimate was accurate to 0.16 KB, which is worth recording because it means the
per-component estimates in that table can be trusted for the next feature.
**8.94 KB of headroom remains**, against the ~8.8 KB predicted.

The CSS estimate was also close: 0.44 KB spent against 0.4 KB projected, leaving
14.11 KB of a 20 KB budget.

**The markdown chunk did not move — the figure is byte-identical at 49.66 KB.**
That is the number that mattered. `ItemDetail` is still reached through
`React.lazy` in `App.tsx`, and mounting it as an outlet child rather than as a
sibling route did not disturb the boundary: it is still emitted as its own
`ItemDetail.js`, and `MarkdownArtifact.js` is still emitted separately below it
(T020). Had the lazy boundary been lost, initial JS would have jumped by ~50 KB
and failed the gate outright rather than degrading quietly.

No contingency was needed. `Items` did not have to move behind a lazy boundary,
and the 150 KB number was not touched.
