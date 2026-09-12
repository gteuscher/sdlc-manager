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
  /**
   * T018, FR-005 — whether this is the row open in the detail pane.
   *
   * A prop, not a route read. The row would only have to look at the URL to
   * learn something its parent already knows, and a component that reaches for
   * the router is a component that cannot be rendered without one (Principle
   * VIII). It defaults to false so a list mounted alone is unchanged.
   */
  readonly selected?: boolean;
  /**
   * 004 — the list's own query string, carried onto this row's link.
   *
   * A `<Link to="/items/KEY">` with a bare string discards the entire query
   * string, which meant selecting a row silently cleared every filter, the
   * search, **and** whether finished work was being shown — the list changing
   * under the cursor at the exact moment the engineer reached for something in
   * it. 003 fixed the list clobbering the detail's `?tab=`; nobody checked the
   * detail *link* clobbering the list's keys, and 004's fifth key is the one
   * whose loss is visible, because losing it changes what the list contains.
   *
   * The caller supplies it, so this row still reads no route (Principle VIII),
   * and so the decision about which keys survive a selection stays in the one
   * component that knows which keys the list owns.
   */
  readonly search?: string;
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

export function ItemRow({
  item,
  selected = false,
  search = '',
  onRetry,
  retrying,
  retryProblem,
}: ItemRowProps): ReactElement {
  const unmapped = isUnmapped(item.stateId);
  const recorded = item.rawState === '' ? '(no value recorded)' : item.rawState;

  const classes = ['row'];
  if (unmapped) classes.push('row--unmapped');
  if (selected) classes.push('row--selected');
  // 004. `item.terminal` arrives already decided by the main process, which is
  // the only place holding the lifecycle definition. The row renders it and
  // never works it out (Principle II).
  if (item.terminal) classes.push('row--finished');

  return (
    // `aria-current` is the whole of what assistive technology needs here, and it
    // is on the row rather than the link because what is current is the item, not
    // a destination — the engineer is already there.
    <li className={classes.join(' ')} aria-current={selected ? true : undefined}>
      <div className="row__head">
        <Link
          className="row__link"
          to={{ pathname: `/items/${encodeURIComponent(item.key)}`, search }}
        >
          <span className="row__key">{item.key}</span>
          <span className="row__title">{item.title}</span>
        </Link>
        {/* Principle XI: never colour alone. The row is also tinted and carries a
            heavier edge, but the word is what survives greyscale, a monochrome
            display, and every form of colour blindness at once. */}
        {selected ? <span className="tag tag--selected">Reading</span> : null}
        {/* FR-003, and never colour alone: the word is the cue that survives
            greyscale. The state it finished in is already in `row__meta` below,
            named by its own lifecycle, so nothing is repeated here. */}
        {item.terminal ? <span className="tag tag--finished">Finished</span> : null}
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
