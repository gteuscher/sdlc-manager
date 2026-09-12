/**
 * T069, T071 — one row of the item list.
 *
 * Carries what FR-002 requires of every row: identifier, title, the SDLC it
 * follows, its current state, and when it was last reconciled with its system of
 * record. Plus the three things the spec's edge cases say must be shown rather
 * than hidden:
 *
 *   **Unmapped state (FR-005).** A recorded value with no counterpart in the
 *   loaded definition is shown *as recorded*, labelled unmapped. It is never
 *   coerced to the nearest state and never dropped from the list. `isUnmapped`
 *   is the only thing that decides this — the sentinel cannot collide with a
 *   real state id, so there is no guessing involved.
 *
 *   **Provider disagreement.** When two providers report different values, the
 *   definition's declared owner wins and the disagreement is named, with the
 *   losing providers and their values. Hiding it would make a wrong-looking row
 *   inexplicable.
 *
 *   **Staleness and retry (FR-037, SC-007).** An item whose provider is failing
 *   stays on screen showing its last reconciled data, marked, with a retry.
 *   Items from healthy providers are untouched by a neighbour's failure.
 *
 * The retry is a prop rather than a hook: the route owns the one mutation and
 * knows which row is pending, so this component has no hidden dependency on a
 * query client (Principle VIII).
 *
 * No control is offered for anything the dashboard cannot do. v1.0 is read-only
 * (FR-034), and a button that does nothing is worse than a sentence saying where
 * the work is actually done (FR-034a) — which is what the attention reason says.
 */

import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { isUnmapped } from '@core/model/observed';
import type { WorkItemSummary } from '@core/model/observed';

import { AttentionBadge } from './AttentionBadge';

export interface ItemRowProps {
  readonly item: WorkItemSummary;
  readonly onRetry: (key: string) => void;
  readonly retrying: boolean;
  /** An in-place, actionable reason the last retry did not help, or null. */
  readonly retryProblem: string | null;
}

/** Provider timestamps are validated as strings, not as dates. An unparseable one shows as recorded. */
function formatTimestamp(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

function stalenessCopy(freshness: WorkItemSummary['freshness']): string {
  return freshness === 'unreachable'
    ? 'This item’s source could not be reached. Showing the last data reconciled from it.'
    : 'This item’s source has not confirmed these details since they were reconciled.';
}

export function ItemRow({ item, onRetry, retrying, retryProblem }: ItemRowProps): ReactElement {
  const unmapped = isUnmapped(item.stateId);
  const recorded = item.rawState === '' ? '(no value recorded)' : item.rawState;

  return (
    <li className={unmapped ? 'row row--unmapped' : 'row'}>
      <div className="row__head">
        <Link className="row__link" to={`/items/${encodeURIComponent(item.key)}`}>
          <span className="row__key">{item.key}</span>
          <span className="row__title">{item.title}</span>
        </Link>
        {item.attention === null ? null : <AttentionBadge signal={item.attention} />}
      </div>

      <p className="row__meta">
        <span className="row__fact">
          <span className="row__fact-label">SDLC</span>
          <span className="row__fact-value">{item.sdlcName}</span>
        </span>
        <span className="row__fact">
          <span className="row__fact-label">Repository</span>
          <span className="row__fact-value">{item.repositoryName}</span>
        </span>
        <span className="row__fact">
          <span className="row__fact-label">State</span>
          {unmapped ? (
            <span className="row__fact-value row__fact-value--unmapped">
              <span className="tag tag--unmapped">Unmapped</span>
              <code className="row__raw">{recorded}</code>
            </span>
          ) : (
            <span className="row__fact-value">{item.stateName ?? recorded}</span>
          )}
        </span>
        <span className="row__fact">
          <span className="row__fact-label">Last reconciled</span>
          <span className="row__fact-value">
            <time dateTime={item.reconciledAt}>{formatTimestamp(item.reconciledAt)}</time>
          </span>
        </span>
      </p>

      {unmapped ? (
        <p className="row__note">
          The recorded value <code className="row__raw">{recorded}</code> has no matching state in
          this item&rsquo;s SDLC definition, so it is shown exactly as recorded rather than being
          mapped to the nearest state.
        </p>
      ) : null}

      {item.disagreements.map((disagreement, index) => (
        <p className="row__note row__note--disagreement" key={`${disagreement.field}-${index}`}>
          <span className="tag tag--disagreement">Providers disagree</span>{' '}
          <span>
            {`On ${disagreement.field}, the definition gives ${disagreement.winner} ownership and it reports “${disagreement.winningValue}”.`}
            {disagreement.others.length === 0
              ? ''
              : ` Also reported: ${disagreement.others
                  .map((other) => `${other.provider} says “${other.value}”`)
                  .join('; ')}.`}
          </span>
        </p>
      ))}

      {item.freshness === 'fresh' ? null : (
        <p className="row__note row__note--stale">
          <span className="tag tag--stale">Stale</span>{' '}
          <span className="row__stale-copy">{stalenessCopy(item.freshness)}</span>{' '}
          <button
            className="button button--small"
            type="button"
            onClick={() => onRetry(item.key)}
            disabled={retrying}
          >
            {retrying ? 'Retrying…' : 'Retry'}
            {/* A list of rows produces a list of buttons all named "Retry". The
                item key is in the accessible name so they can be told apart,
                and stays out of the visible label so the row stays scannable. */}
            <span className="sr-only"> reconciling {item.key}</span>
          </button>
          {retryProblem === null ? null : (
            <span className="row__retry-problem" role="alert">
              {retryProblem}
            </span>
          )}
        </p>
      )}
    </li>
  );
}
