/**
 * T082 — every gate a state declares, and each gate's recorded result (FR-014).
 *
 * The one assertion this component exists to make: **`not_evaluated` is a third
 * value, not a soft pass.** SC-005 puts a number on it — 100% of gates shown as
 * passed correspond to a recorded passing evaluation, and no gate lacking a
 * result is ever shown as passed — and Principle V says absence of a result is
 * never treated as success. So the three statuses differ in three independent
 * ways, exactly as the attention kinds do:
 *
 *   - **text**   — "Passed", "Failed", "Not evaluated". Three different words.
 *                  Greyscale-safe, screen-reader-safe, and the only cue that
 *                  cannot be lost to a display setting.
 *   - **shape**  — a check in a filled disc, a cross in a square, an open dashed
 *                  ring with a dash through it. Drawn, not tinted.
 *   - **colour** — third, and never load-bearing on its own.
 *
 * Beside the status goes the recorded reason. Principle V requires the interface
 * to say *why* a gate passed or failed, and `GateResult.detail` is where the
 * engine put it. A gate that has never been evaluated has no reason to give, so
 * it gets copy saying that plainly rather than an empty slot an engineer could
 * read as "fine" — Principle X's deliberate nothing.
 *
 * Nothing here is a control. v1.0 is read-only (FR-034); where an action is owed
 * it is named by `StateActions`, which says where it is performed (FR-034a).
 *
 * No gate name, state name, or provider name appears in this file. Every string
 * an engineer reads about a specific gate came from the loaded definition or
 * from the recorded result (Principle II, SC-010, SC-014).
 */

import type { ReactElement } from 'react';

import type { GateStatus, GateView } from '@core/model/observed';

export interface GateListProps {
  /** Every gate the state declares, with its result. Order is the definition's. */
  readonly gates: readonly GateView[];
}

const STATUS_LABELS: Readonly<Record<GateStatus, string>> = {
  passed: 'Passed',
  failed: 'Failed',
  not_evaluated: 'Not evaluated',
};

/**
 * What the interface says when the engine recorded no reason. Never blank: an
 * empty explanation beside a gate reads as approval.
 */
const FALLBACK_DETAIL: Readonly<Record<GateStatus, string>> = {
  passed: 'The evaluation passed. No further detail was recorded.',
  failed: 'The evaluation failed. No further detail was recorded.',
  not_evaluated:
    'No evaluation has been recorded for this gate. Its outcome is unknown — this is not a pass.',
};

function statusMark(status: GateStatus): ReactElement {
  switch (status) {
    case 'passed':
      return (
        <svg
          className="gate__mark"
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
    case 'failed':
      return (
        <svg
          className="gate__mark"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="1.2" y="1.2" width="13.6" height="13.6" rx="2" fill="currentColor" />
          <path
            d="M5.2 5.2 10.8 10.8M10.8 5.2 5.2 10.8"
            fill="none"
            stroke="var(--bg-raised)"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'not_evaluated':
      return (
        <svg
          className="gate__mark"
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
          <path d="M4.9 8h6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

/** Recorded timestamps are validated as strings, not as dates. An unparseable one shows as recorded. */
function formatTimestamp(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

export function GateList({ gates }: GateListProps): ReactElement {
  if (gates.length === 0) {
    // Principle X: a deliberate nothing, with copy, rather than a blank frame.
    return (
      <p className="gates__none">
        This state declares no gates, so there is nothing here to pass or fail.
      </p>
    );
  }

  return (
    <ul className="gates">
      {gates.map((gate) => {
        const status = gate.result.status;

        return (
          <li className={`gate gate--${status}`} key={gate.id}>
            <p className="gate__head">
              <span className={`gate__status gate__status--${status}`}>
                {statusMark(status)}
                <span className="gate__status-label">{STATUS_LABELS[status]}</span>
              </span>
              <span className="gate__name">{gate.name}</span>
              <span className="gate__kind">{gate.kind}</span>
              {gate.blocking ? (
                <span className="tag tag--blocking">Blocking</span>
              ) : (
                <span className="tag tag--advisory">Advisory</span>
              )}
            </p>

            <p className="gate__detail">{gate.result.detail ?? FALLBACK_DETAIL[status]}</p>

            <p className="gate__meta">
              {gate.result.evaluatedAt === null ? (
                <span className="gate__fact">Never evaluated</span>
              ) : (
                <span className="gate__fact">
                  Evaluated{' '}
                  <time dateTime={gate.result.evaluatedAt}>
                    {formatTimestamp(gate.result.evaluatedAt)}
                  </time>
                </span>
              )}
              {gate.result.evidence === null ? null : (
                <span className="gate__fact">
                  Evidence from {gate.result.evidence.provider}:{' '}
                  {/* Display only. The renderer cannot resolve a locator
                      (ipc-surface.md rule 4), so it is shown, never linked. */}
                  <code className="gate__locator">{gate.result.evidence.locator}</code>
                </span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
