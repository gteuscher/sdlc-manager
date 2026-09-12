/**
 * T047 — the renderer's composition root.
 *
 * Everything the application depends on is wired here and nowhere else, so that
 * no component acquires a provider implicitly (Principle VIII). A test renders a
 * route with its own client and its own router; nothing under `App` reaches for
 * a singleton.
 *
 * The router is a `HashRouter` rather than a `BrowserRouter` because the packaged
 * renderer loads from a `file://` URL. Path-based history there rewrites the
 * document's path against the filesystem, and a reload lands on a path no file
 * exists at. The fragment is the only history a `file://` document can own.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router';

import { App } from './App';
import { createQueryClient } from './query/client';

function mount(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

const container = document.getElementById('root');

// A missing root is a packaging fault, not a user-facing condition, so it fails
// loudly rather than leaving the fallback markup on screen pretending to load.
if (container === null) {
  throw new Error('The renderer root element is missing. index.html did not load as expected.');
} else {
  mount(container);
}
