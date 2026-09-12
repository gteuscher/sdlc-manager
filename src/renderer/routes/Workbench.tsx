/**
 * T013, T016, T017, T026, T027, T029, T036 — the two-pane workbench.
 *
 * The list and the detail become two panes of one view instead of two pages. The
 * mechanism is a parent layout route: this component mounts the list itself and
 * renders the detail through `<Outlet />`, so selecting an item changes only what
 * the outlet renders. FR-004's "without replacing, reloading, or repositioning
 * the list" is then a property of *where the list is mounted* rather than
 * something the code has to remember to preserve.
 *
 * **This file arranges. It does not know what a pane contains.** plan.md's
 * Structure Decision names the failure mode directly: a shell that accumulates
 * the responsibilities of both children until neither can be tested alone. So
 * there is no data fetching here, no filter logic, no state or gate vocabulary,
 * and no knowledge of either pane's internals. The boundary has a test, and it is
 * worth restating because it is the one a future change will break first:
 * **deleting this file and restoring two route entries returns the product to two
 * pages, with no change to either pane's source.**
 *
 * What it does own, and why each is here rather than in a pane:
 *
 *   **The grid**, because arrangement is the whole feature.
 *   **The collapse control and its preference**, because the pane being collapsed
 *     is a fact about the furniture, not about the work (Principle XIII, and the
 *     justification in `usePaneState`).
 *   **Which pane exists at a narrow width**, because that is a decision about the
 *     arrangement as a whole; neither pane could make it alone.
 *   **The selected key**, read off the route and handed *down* to the list. The
 *     list needs it to mark the current row (FR-005) and to say when the filters
 *     have excluded what is being read (FR-015). Deriving it from the route is a
 *     routing concern and therefore the shell's; what it means for a list is the
 *     list's, and stays there.
 *
 * Each pane carries its **own** error boundary rather than sharing the route-level
 * one. That is FR-019 as a structural guarantee rather than a convention: a
 * thrown render in the detail leaves the list rendered and selectable, so the
 * engineer can move to another item instead of reloading the application.
 */

import { Suspense, useCallback, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router';

import { CollapsedRail } from '../components/CollapsedRail';
import { PaneToggle } from '../components/PaneToggle';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary';
import { usePaneState } from '../query/usePaneState';
import { Items } from './Items';

/**
 * Below this, two panes stop being two panes and become two unusable columns.
 *
 * FR-017 requires that neither pane is ever rendered unusable and SC-007 states
 * the property rather than a number, deliberately — a width in the specification
 * would have been invented. This is the design judgement the specification left
 * open: roughly the point at which the list can no longer show an identifier and
 * an attention marker on one line beside a readable detail.
 *
 * research.md §4 expected this to live in a stylesheet. It lives in JavaScript
 * instead, for a reason that outweighs the tidiness: a threshold expressed only
 * in CSS is **unverifiable by any gate this project runs**. Component tests
 * evaluate no stylesheet, so "exactly one pane below the threshold" would have
 * been an untested claim about the one behaviour most likely to rot. Deciding it
 * here also makes the degradation honest — the other pane is genuinely absent,
 * not merely painted out while still in the accessibility tree and the tab order.
 */
const NARROW_QUERY = '(max-width: 899px)';

/**
 * `matchMedia` is absent or throwing in some embedding contexts, and the honest
 * fallback is the full arrangement: a wide window is the state in which nothing
 * is withheld.
 */
function narrowMedia(): MediaQueryList | null {
  try {
    return window.matchMedia(NARROW_QUERY);
  } catch {
    return null;
  }
}

function subscribeToWidth(onChange: () => void): () => void {
  const query = narrowMedia();
  if (query === null) return () => undefined;
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isNarrow(): boolean {
  return narrowMedia()?.matches ?? false;
}

/** Subscribed rather than sampled, so a resize across the threshold re-arranges immediately. */
function useNarrowWindow(): boolean {
  return useSyncExternalStore(subscribeToWidth, isNarrow, () => false);
}

export function Workbench(): ReactElement {
  const listBodyId = useId();
  const location = useLocation();
  const narrow = useNarrowWindow();
  const { collapsed, toggle } = usePaneState();

  // The route is the only record of what is selected (FR-007, data-model.md).
  // A layout route sees its own match, not its child's, so the child path is
  // matched explicitly rather than read from `useParams`.
  //
  // `useMatch` decodes the parameter for us, exactly as `useParams` does for the
  // detail pane. Decoding it a second time here would be a real bug rather than a
  // belt-and-braces one: an item key containing a literal percent sign would come
  // back differently in the two panes, and the list would fail to mark the row the
  // detail is showing.
  const detail = useMatch('/items/:key');
  const selectedKey = detail?.params.key ?? null;

  // In single-pane mode the URL decides which pane exists, and nothing new is
  // remembered (contracts/workbench-layout.md §5). Collapsing is meaningless
  // there — there is no second pane to give the width to — so the preference is
  // held but not applied until the window is wide again.
  const showList = !narrow || selectedKey === null;
  const showDetail = !narrow || selectedKey !== null;
  const listCollapsed = collapsed && !narrow;

  // ── FR-010: expanding restores the scroll position ────────────────────────
  // The list is hidden rather than unmounted, so its React state survives a
  // collapse. Its *scroll offset* does not survive on its own: a region with no
  // layout box has no scroll position for a browser to keep, so it is recorded
  // as the engineer scrolls and written back on the way out. The scroll container
  // is this component's own element, not anything belonging to the list.
  const listBody = useRef<HTMLDivElement | null>(null);
  const scrollOffset = useRef(0);

  const rememberScroll = useCallback(() => {
    const node = listBody.current;
    if (node !== null) scrollOffset.current = node.scrollTop;
  }, []);

  useLayoutEffect(() => {
    if (listCollapsed) return;
    const node = listBody.current;
    if (node !== null) node.scrollTop = scrollOffset.current;
  }, [listCollapsed]);

  const onToggle = useCallback(() => {
    // Recorded before the pane loses its layout box, not after.
    rememberScroll();
    toggle();
  }, [rememberScroll, toggle]);

  // Exactly one `main` per view. Wide, that is the detail; in single-pane mode
  // the pane on screen *is* the main content, which is also what this product did
  // as two pages, so the degradation reproduces rather than reinvents.
  const ListPane = narrow ? 'main' : 'aside';

  return (
    <div
      className={listCollapsed ? 'workbench workbench--collapsed' : 'workbench'}
      data-narrow={narrow ? 'true' : 'false'}
    >
      {showList ? (
        <ListPane className="workbench__pane workbench__list" aria-label="Work items">
          <div className="workbench__list-bar">
            {/* Outside the region it controls, so a pane collapsed to nothing
                cannot take its own expand control with it (FR-012). Withheld at
                narrow widths, where there is nothing to collapse toward. */}
            {narrow ? null : (
              <PaneToggle expanded={!listCollapsed} controls={listBodyId} onToggle={onToggle} />
            )}
            {listCollapsed ? <CollapsedRail /> : null}
          </div>

          <div
            className="workbench__list-body"
            id={listBodyId}
            hidden={listCollapsed}
            ref={listBody}
            onScroll={rememberScroll}
          >
            {/* A stable reset key: a failure in the list is cleared by its own
                retry, not by selecting a different item in it. */}
            <RouteErrorBoundary resetKey="workbench-list">
              <Items selectedKey={selectedKey} />
            </RouteErrorBoundary>
          </div>
        </ListPane>
      ) : null}

      {showDetail ? (
        <main className="workbench__pane workbench__detail" aria-label="Item detail">
          {/* Reset on the path, so selecting another item is a fresh attempt.
              The Suspense boundary is inside the detail pane rather than around
              the view, so loading the detail's chunk on first selection cannot
              unmount the list (FR-004). */}
          <RouteErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<DetailPending />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      ) : null}
    </div>
  );
}

/**
 * FR-020's bounded wait, and the bound is structural rather than timed.
 *
 * This covers only the moment the detail's code is being fetched from local disk
 * beside the page — not a provider round trip, which is where Principle X's
 * ten-second ceiling applies and where `ItemDetail` already enforces it. A chunk
 * that genuinely cannot be fetched rejects, and the pane's error boundary renders
 * the failure with a retry, so no path through here waits indefinitely.
 */
function DetailPending(): ReactElement {
  return (
    <p className="pending" role="status">
      Opening this work item&hellip;
    </p>
  );
}
