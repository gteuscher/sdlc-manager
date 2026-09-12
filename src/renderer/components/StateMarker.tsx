/**
 * T081 — how far the item has travelled, per state (FR-013).
 *
 * Four values, and they must be separable without colour (Principle XI). Each
 * one differs in three independent ways, the same discipline `AttentionBadge`
 * uses for the two attention kinds:
 *
 *   - **text**   — "Completed", "Current", "Blocked", "Not reached". Four
 *                  different words. This is what a screen reader reads and the
 *                  only cue that survives a greyscale display, so it is always
 *                  rendered — visibly in a panel heading, assistively inside a
 *                  tab where the state's own name has to stay scannable.
 *   - **shape**  — a filled check, a ringed dot, a triangle, a dashed outline.
 *                  Drawn rather than coloured, so the four remain separable at a
 *                  glance and at a distance.
 *   - **colour** — third, and never load-bearing on its own.
 *
 * `StateProgress` is a value of *this application's* observed model, derived by
 * the main process from the loaded definition. It is not lifecycle vocabulary:
 * no state name, gate name, or provider name appears here, and this component
 * renders an SDLC it has never seen exactly as well as a familiar one
 * (Principle II, SC-010).
 */

import type { ReactElement } from 'react';

import type { StateProgress } from '@core/model/observed';

export interface StateMarkerProps {
  readonly progress: StateProgress;
  /**
   * True to show the word beside the mark; false to keep it for assistive
   * technology only. Never absent — the word is the cue that cannot be dropped.
   */
  readonly showLabel: boolean;
}

const LABELS: Readonly<Record<StateProgress, string>> = {
  completed: 'Completed',
  current: 'Current',
  blocked: 'Blocked',
  not_reached: 'Not reached',
};

/** A distinct drawn shape per value, so greyscale never collapses two of them together. */
function mark(progress: StateProgress): ReactElement {
  switch (progress) {
    case 'completed':
      return (
        <svg
          className="state-marker__mark"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="M4.4 8.3 6.9 10.8 11.7 5.6"
            fill="none"
            stroke="var(--bg-raised)"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'current':
      return (
        <svg
          className="state-marker__mark"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        </svg>
      );
    case 'blocked':
      return (
        <svg
          className="state-marker__mark"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M8 1.6 15 14.4H1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8 6v3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="12" r="0.95" fill="currentColor" />
        </svg>
      );
    case 'not_reached':
      return (
        <svg
          className="state-marker__mark"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <circle
            cx="8"
            cy="8"
            r="6.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="2.6 2.4"
          />
        </svg>
      );
  }
}

export function StateMarker({ progress, showLabel }: StateMarkerProps): ReactElement {
  const label = LABELS[progress];

  return (
    <span className={`state-marker state-marker--${progress}`}>
      {mark(progress)}
      <span className={showLabel ? 'state-marker__label' : 'sr-only'}>{label}</span>
    </span>
  );
}
