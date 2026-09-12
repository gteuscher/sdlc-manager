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
 */

import { Suspense, lazy } from 'react';
import type { ReactElement } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';

import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { useChangeEvents } from './query/hooks';
import { Items } from './routes/Items';

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
          click away is most of the recovery (Principle X). */}
      <main className="app__main">
        <RouteErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<RoutePending />}>
            <Routes>
              <Route path="/" element={<Items />} />
              <Route path="/items/:key" element={<ItemDetail />} />
              <Route path="/repositories" element={<Repositories />} />
              {/* An unrecognised fragment resolves to the list rather than to a
                  blank frame (Principle X). */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </main>
    </div>
  );
}
