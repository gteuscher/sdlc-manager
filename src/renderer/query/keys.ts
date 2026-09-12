/**
 * Query keys, in one place.
 *
 * Change events are invalidations naming what changed (ipc-surface.md §3), so the
 * key shapes here have to line up with those four event types — otherwise an
 * invalidation arrives and nothing refetches, and the dashboard silently stops
 * updating without a restart, which is precisely what FR-010 forbids.
 */

import type { ItemFilter } from '@core/ipc/schema';

export const queryKeys = {
  packages: () => ['packages'] as const,
  /** Where discovery looked. Fixed for the life of the process, but cached like any read. */
  packageSearchPaths: () => ['packageSearchPaths'] as const,
  repositories: () => ['repositories'] as const,
  items: (filter?: ItemFilter) => ['items', filter ?? {}] as const,
  /** Prefix for every filtered item list, so one event invalidates them all. */
  itemsAll: () => ['items'] as const,
  item: (key: string) => ['item', key] as const,
  artifact: (key: string, stateId: string, artifactId: string) => ['artifact', key, stateId, artifactId] as const,
  conversation: (key: string, stateId: string) => ['conversation', key, stateId] as const,
  /**
   * One assistant serves every console, so this is not scoped by item or state.
   * Keeping it unscoped is what stops a six-state item probing six times.
   */
  consoleAvailability: () => ['consoleAvailability'] as const,
};
