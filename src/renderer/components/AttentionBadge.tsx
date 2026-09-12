/**
 * T066 — the attention marker (FR-006).
 *
 * The two kinds must be **visibly distinct**, and colour alone is not a
 * distinction (Principle XI). So each kind differs in three independent ways:
 *
 *   - **text**    — "Awaiting your input" against "Gate failed". Different
 *                   words, not the same word in two colours; this is the cue a
 *                   screen reader gets and the only one that survives a
 *                   greyscale display.
 *   - **shape**   — a circle against a triangle, drawn rather than coloured, so
 *                   the two remain separable at a glance and at a distance.
 *   - **colour**  — third, and never load-bearing on its own.
 *
 * The signal's `reason` is rendered beside the badge rather than hidden behind a
 * tooltip. It is the sentence that says where the action is performed, which is
 * what FR-034a asks for in a read-only application: this component deliberately
 * presents no control, because there is no transition, approval, or retry the
 * dashboard can perform in v1.0 (FR-034).
 *
 * The kinds come from `AttentionKind` in the observed model — a derived property
 * of the application's own contract, not vocabulary from anyone's lifecycle.
 */

import type { ReactElement } from 'react';

import type { AttentionSignal } from '@core/model/observed';

export interface AttentionBadgeProps {
  readonly signal: AttentionSignal;
}

export function AttentionBadge({ signal }: AttentionBadgeProps): ReactElement {
  const awaitingInput = signal.kind === 'input_needed';

  const mark = awaitingInput ? (
    <svg
      className="badge__mark"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text x="8" y="11.6" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="currentColor">
        ?
      </text>
    </svg>
  ) : (
    <svg
      className="badge__mark"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 1.4 15.2 14.6H0.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <text x="8" y="13.2" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor">
        !
      </text>
    </svg>
  );

  return (
    <span className="attention">
      <span className={awaitingInput ? 'badge badge--input' : 'badge badge--gate'}>
        {mark}
        <span className="badge__label">{awaitingInput ? 'Awaiting your input' : 'Gate failed'}</span>
      </span>
      <span className="attention__reason">{signal.reason}</span>
    </span>
  );
}
