/**
 * T025 — the control that collapses the list pane (FR-008, FR-012).
 *
 * A real `<button>`, with `aria-expanded` reflecting the state and
 * `aria-controls` naming the region it governs
 * ([contracts/workbench-layout.md](../../../specs/003-two-pane-workbench/contracts/workbench-layout.md) §2).
 * Nothing here is invented: the disclosure pattern is what a browser and a screen
 * reader already understand, and Principle XI's scope note is explicit that a
 * single maintainer should reach for the built-in behaviour rather than
 * hand-rolling one.
 *
 * Two details are requirements rather than taste.
 *
 * **The label says what pressing it will do**, and changes with the state, so a
 * screen-reader user is never told "collapse" by a control that expands. Sighted
 * users get the same sentence as a tooltip; the drawn chevron is decorative and
 * hidden from assistive technology, because a mark that is announced as well as
 * labelled says everything twice.
 *
 * **This component renders outside the region it controls.** A pane collapsed to
 * nothing that took its own expand control with it would be a trap, and FR-012
 * forbids it in as many words. The button's placement is the caller's
 * responsibility, but the reason it must stay outside is recorded here, where
 * someone moving it will read it.
 */

import type { ReactElement } from 'react';

export interface PaneToggleProps {
  /** Whether the controlled region is currently expanded. */
  readonly expanded: boolean;
  /** The `id` of the region this button shows and hides. */
  readonly controls: string;
  readonly onToggle: () => void;
}

export function PaneToggle({ expanded, controls, onToggle }: PaneToggleProps): ReactElement {
  const label = expanded ? 'Hide the work item list' : 'Show the work item list';

  return (
    <button
      type="button"
      className="pane-toggle"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      title={label}
    >
      <svg
        className="pane-toggle__mark"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
        focusable="false"
      >
        {/* Points the way the pane will move, so the mark and the label agree. */}
        <path
          d={expanded ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </button>
  );
}
