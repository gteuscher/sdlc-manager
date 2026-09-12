/**
 * T048 — the reconciliation cache.
 *
 * TanStack Query is doing the work FR-002, FR-010, FR-018, and FR-037 describe:
 * a per-datum "last reconciled" time, updates without a restart, stale marking,
 * and a retry when a provider fails. Principle XIII independently calls server
 * state "cache, not store", which is what this is.
 *
 * Two settings below are requirements rather than preferences:
 *
 *   `staleTime` — data is stale by default rather than fresh forever, because
 *   FR-018 requires the interface to say when something was last reconciled, and
 *   a cache that never goes stale would make that timestamp a lie.
 *
 *   `retry` with a bounded delay — Principle X: no loading spinner without a
 *   timeout, no error state without a retry path, ten seconds the default
 *   ceiling. A provider failure must arrive as a rendered state, not a hang.
 */

import { QueryClient } from '@tanstack/react-query';

/** How long a reconciled value is treated as fresh before it is marked stale. */
export const STALE_AFTER_MS = 30_000;

/** Principle X's default ceiling on a provider-bound wait. */
export const REQUEST_CEILING_MS = 10_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_AFTER_MS,
        // Reconciliation is driven by invalidation events from the main process
        // (FR-010), so polling on an interval here would duplicate the poll the
        // remote providers already run.
        refetchInterval: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
        // One failing provider must not take down the view: retry briefly, then
        // surface the failure with a retry path (FR-037, SC-007).
        retry: 2,
        retryDelay: (attempt) => Math.min(REQUEST_CEILING_MS, 500 * 2 ** attempt),
        // Keeping the previous value visible while refetching is what lets items
        // from healthy providers stay on screen while a failing one is retried.
        placeholderData: <T,>(previous: T) => previous,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
