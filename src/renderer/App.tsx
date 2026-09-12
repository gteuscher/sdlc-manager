/**
 * T047 — the shell: the three routes, and the one subscription that keeps them
 * current.
 *
 * `useChangeEvents()` is called once, here, for the life of the application. It
 * is what makes FR-010 true: the main process emits an invalidation naming what
 * changed, the affected query keys refetch, and rows update without the engineer
 * restarting anything. Calling it per route would drop the subscription on every
 * navigation; calling it twice would double every refetch.
 *
 * The detail and repositories routes are lazy. That is Principle XII rather than
 * taste — markdown rendering must not be in the initial bundle, and the detail
 * route is where markdown lives.
 *
 * T015 — `/` is now a **layout route**. `Workbench` renders the list itself and
 * the detail through its outlet, which is the whole mechanism behind FR-001 and
 * FR-004: the two panes are one route hierarchy, so selecting an item re-renders
 * the child and leaves the parent — and therefore the list — mounted.
 *
 * **Every existing URL still resolves** (FR-007). `/` and `/items/:key` mean
 * exactly what they meant as sibling routes; only their nesting changed.
 * `/repositories` is untouched (FR-022) and keeps its own `main` landmark,
 * because the workbench's `main` is the detail pane and a document has one.
 */

import { Suspense, lazy } from 'react';
import type { ReactElement } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';

import { NoSelection } from './components/NoSelection';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { useChangeEvents } from './query/hooks';
import { Workbench } from './routes/Workbench';

const ItemDetail = lazy(() => import('./routes/ItemDetail'));
const Repositories = lazy(() => import('./routes/Repositories'));

/**
 * The lazy chunks sit on local disk beside the page, so this wait is not
 * provider-bound and Principle X's ten-second ceiling does not apply to it.
 * Provider-bound waits are bounded where they are made — see `Items.tsx`, which
 * times out its list load and its retry against `REQUEST_CEILING_MS`.
 */
function RoutePending(): ReactElement {
  return (
    <p className="pending" role="status">
      Loading this view&hellip;
    </p>
  );
}

export function App(): ReactElement {
  useChangeEvents();
  const location = useLocation();

  return (
    <div className="app">
      <header className="app__bar">
        <p className="app__brand">SDLC Manager</p>
        <nav className="app__nav" aria-label="Primary">
          <NavLink className="app__nav-link" to="/" end>
            Work items
          </NavLink>
          <NavLink className="app__nav-link" to="/repositories">
            Repositories
          </NavLink>
        </nav>
      </header>

      {/* The boundary sits inside the shell, not around it, so a route that
          fails to render leaves the navigation above it working — being able to
          click away is most of the recovery (Principle X). The workbench adds a
          second boundary per pane, so a failure in one pane cannot blank the
          other (FR-019); this outer one now catches only a failure of the shell
          itself. */}
      <RouteErrorBoundary resetKey={location.pathname}>
        <Routes>
          {/* The layout route. Its children are the detail pane. */}
          <Route path="/" element={<Workbench />}>
            <Route index element={<NoSelection />} />
            {/* Still `/items/:key`, and still lazy: this is the boundary that
                keeps `react-markdown` out of the initial bundle (Principle XII,
                T020). The Suspense that awaits it lives inside the workbench's
                detail pane, so the wait cannot unmount the list. */}
            <Route path="items/:key" element={<ItemDetail />} />
          </Route>

          <Route
            path="/repositories"
            element={
              <main className="app__main">
                <Suspense fallback={<RoutePending />}>
                  <Repositories />
                </Suspense>
              </main>
            }
          />

          {/* An unrecognised fragment resolves to the list rather than to a
              blank frame (Principle X). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RouteErrorBoundary>
    </div>
  );
}
