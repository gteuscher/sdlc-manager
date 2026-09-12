/**
 * T067 — the count of items needing attention (FR-009).
 *
 * `role="status"` rather than plain text: the count changes when the main
 * process reconciles and invalidates (FR-010), and a number that silently
 * changes is a number a screen-reader user never learns about.
 *
 * `hiddenByFilters` exists because a count that describes only the filtered list
 * can lie by omission — an engineer who filtered to one repository would read
 * "nothing needs you" while two items elsewhere wait. The count describes what is
 * listed; the suffix names what the filters are hiding.
 */

import type { ReactElement } from 'react';

export interface AttentionCountProps {
  /** How many of the currently listed items carry an attention signal. */
  readonly count: number;
  /** How many attention-carrying items the active filters are excluding. */
  readonly hiddenByFilters: number;
}

export function AttentionCount({ count, hiddenByFilters }: AttentionCountProps): ReactElement {
  const hidden =
    hiddenByFilters > 0
      ? ` ${hiddenByFilters} more ${hiddenByFilters === 1 ? 'is' : 'are'} hidden by the current filters.`
      : '';

  if (count === 0) {
    return (
      <p className="attention-count attention-count--clear" role="status">
        <span>Nothing here needs your attention right now.</span>
        <span>{hidden}</span>
      </p>
    );
  }

  return (
    <p className="attention-count" role="status">
      <span className="attention-count__number">{count}</span>
      <span>{count === 1 ? ' item needs your attention.' : ' items need your attention.'}</span>
      <span>{hidden}</span>
    </p>
  );
}
