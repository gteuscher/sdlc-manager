/**
 * T079, T080, T084, T090 — User Story 2: following one item through its SDLC
 * states, and User Story 3's frame for the artifacts behind each one.
 *
 * Four decisions in here are requirements rather than preferences.
 *
 * **The tabs are the definition.** Their number, their order, their labels, and
 * which one opens are all read from the `WorkItemDetail` the main process
 * resolved against this repository's own loaded manifest. There is no list of
 * states in this file, no fallback lifecycle, and no name of any state, gate, or
 * provider anywhere in it — a lint rule enforces the last part, and SC-003 and
 * SC-010 are the reason it exists. An SDLC this application has never seen
 * renders here on first load, and upgrading a package to declare a seventh state
 * makes a seventh tab appear with no change to this code (SC-013).
 *
 * **The selected state lives in the URL.** The item is already a path segment;
 * the state is a query parameter beside it (FR-015, Principle XIII). There is no
 * store and no context holding it, so a state view is a link — bookmarkable,
 * shareable, restored by the back button, and unaffected by the change events
 * that refetch this item without a restart (FR-010). `replace` rather than
 * `push`, so clicking through six tabs does not bury the item list under six
 * history entries.
 *
 * **An unmapped item is reported, not repaired (FR-005, FR-046).** When a
 * package is upgraded and a state the item was resting in no longer exists, the
 * main process resolves the state to the `UNMAPPED` sentinel and sets
 * `currentStateId` to null. This route then has no current tab to open — and the
 * one thing it must not do is pick the nearest state and let the marker imply
 * the item is there. It opens on the first declared state, says plainly that
 * none of them is where the item is, and shows the raw recorded value exactly as
 * the provider wrote it. Nothing is dropped and nothing is reassigned.
 *
 * **The markdown parser is lazy, and this is where that boundary lives.**
 * `MarkdownArtifact` is reached only through the `React.lazy` call below, which
 * makes it a chunk of its own that `.size-limit.json` budgets by name. Principle
 * XII states the consequence directly: React, a router, a schema validator, a
 * markdown parser, and a sanitizer exceed the 150 KB initial budget together, so
 * markdown rendering MUST be lazy-loaded into this route. The component is
 * handed down to `ArtifactPanel` as a prop so the boundary stays in one visible
 * place instead of being re-derived wherever an artifact happens to be rendered
 * (Principle VIII).
 */

import { lazy, useCallback, useEffect, useId, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { isUnmapped } from '@core/model/observed';
import type {
  AttentionSignal,
  StateView,
  WorkItemDetail,
  WorkItemSummary,
} from '@core/model/observed';

import { ArtifactPanel } from '../components/ArtifactPanel';
import { AttentionBadge } from '../components/AttentionBadge';
import { Console } from '../components/Console';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { GateList } from '../components/GateList';
import { StateActions } from '../components/StateActions';
import { StateMarker } from '../components/StateMarker';
import { StateTabs } from '../components/StateTabs';
import { REQUEST_CEILING_MS } from '../query/client';
import { useItem, useRefresh } from '../query/hooks';

import './ItemDetail.css';

/** T090. The lazy boundary. Nothing else in the renderer imports this module. */
const MarkdownArtifact = lazy(() => import('../components/MarkdownArtifact'));

const PARAM_STATE = 'state';
const ITEMS_ROUTE = '/';

/** Provider timestamps are validated as strings, not as dates. An unparseable one shows as recorded. */
function formatTimestamp(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

function stalenessCopy(freshness: WorkItemSummary['freshness']): string {
  return freshness === 'unreachable'
    ? 'This item’s source could not be reached. Everything below is the last data reconciled from it.'
    : 'This item’s source has not confirmed these details since they were reconciled.';
}

/**
 * Which tab is open. The URL wins when it names a state this definition declares;
 * otherwise the state the item occupies (FR-012); otherwise the first declared
 * state, which is all an unmapped item can be shown against without pretending.
 */
function selectedStateId(detail: WorkItemDetail, requested: string | null): string {
  if (requested !== null && detail.states.some((state) => state.id === requested)) return requested;
  if (detail.currentStateId !== null) return detail.currentStateId;
  const first = [...detail.states].sort((left, right) => left.ordinal - right.ordinal)[0];
  return first?.id ?? '';
}

// ── One state's panel ───────────────────────────────────────────────────────

interface StatePanelProps {
  readonly itemKey: string;
  readonly state: StateView;
  /** The item's attention signal, whichever state it was raised against. */
  readonly itemAttention: AttentionSignal | null;
}

function StatePanel({ itemKey, state, itemAttention }: StatePanelProps): ReactElement {
  const artifactsHeadingId = useId();

  // The signal belongs to this panel only when it was raised against this state.
  // Repeating an unrelated signal on every tab would make the tab that actually
  // stalled indistinguishable from the five that did not.
  const attention =
    itemAttention !== null && itemAttention.stateId === state.id ? itemAttention : null;

  // Story 2 acceptance 4: a state the item has not reached shows **no fabricated
  // artifacts**. Nothing is read for it. The declared names are still listed,
  // because naming what a state *will* carry is reading the manifest, whereas
  // rendering content for it would be inventing evidence.
  const reached = state.progress !== 'not_reached';

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">{state.name}</h2>
        <StateMarker progress={state.progress} showLabel />
        {state.terminal ? <span className="tag tag--terminal">Final state</span> : null}
      </div>

      {state.description === null ? null : (
        <p className="panel__description">{state.description}</p>
      )}

      {attention === null ? null : (
        <p className="panel__attention">
          <AttentionBadge signal={attention} />
        </p>
      )}

      <StateActions
        progress={state.progress}
        awaitsHuman={state.awaitsHuman}
        gates={state.gates}
        attention={attention}
      />

      <section className="panel__section" aria-labelledby={`${artifactsHeadingId}-gates`}>
        <h3 className="panel__section-title" id={`${artifactsHeadingId}-gates`}>
          Gates
        </h3>
        <GateList gates={state.gates} />
      </section>

      {/* FR-027. Scoped to this state of this item, and mounted with the panel,
          so only the selected tab's console exists at all. It sits above the
          artifacts because those are whole documents of unbounded length: a
          console below them would be off the bottom of a long state, and their
          own headings would break this panel's heading outline if any of ours
          followed them. */}
      <Console itemKey={itemKey} stateId={state.id} stateName={state.name} />

      <section className="panel__section" aria-labelledby={artifactsHeadingId}>
        <h3 className="panel__section-title" id={artifactsHeadingId}>
          Artifacts
        </h3>

        {state.artifacts.length === 0 ? (
          <p className="panel__none">This state declares no artifacts.</p>
        ) : !reached ? (
          <div className="panel__unreached">
            <p>
              The item has not reached this state, so none of its artifacts has been produced. What
              its SDLC definition declares here is:
            </p>
            <ul className="panel__declared">
              {state.artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <span className="panel__declared-name">{artifact.name}</span>
                  <span className="panel__declared-kind">{artifact.kind}</span>
                  <span className="panel__declared-source">from {artifact.provider}</span>
                  {artifact.required ? <span className="tag tag--required">Required</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="panel__artifacts">
            {state.artifacts.map((artifact) => (
              <ArtifactPanel
                key={artifact.id}
                itemKey={itemKey}
                stateId={state.id}
                artifact={artifact}
                markdownView={MarkdownArtifact}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── The route ───────────────────────────────────────────────────────────────

export default function ItemDetail(): ReactElement {
  const headingId = useId();
  const params = useParams();
  const itemKey = params.key ?? '';

  const [search, setSearch] = useSearchParams();
  const item = useItem(itemKey === '' ? undefined : itemKey);
  const refresh = useRefresh();

  const onStateChange = useCallback(
    (stateId: string) => {
      const next = new URLSearchParams(search);
      next.set(PARAM_STATE, stateId);
      // Replace rather than push: clicking through a six-state lifecycle must
      // not put six entries between the engineer and the item list.
      setSearch(next, { replace: true });
    },
    [search, setSearch],
  );

  // ── Principle X: no wait without a ceiling ────────────────────────────────
  const pending = item.isPending;
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), REQUEST_CEILING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending]);

  const back = (
    <p className="detail__back">
      <Link to={ITEMS_ROUTE}>&larr; All work items</Link>
    </p>
  );

  if (pending && !timedOut) {
    return (
      <section className="detail">
        {back}
        <p className="pending" role="status">
          Reconciling this work item with its system of record&hellip;
        </p>
      </section>
    );
  }

  if (pending) {
    return (
      <section className="detail">
        {back}
        <ErrorState
          title="This is taking longer than it should"
          message="This item has not answered within ten seconds. The provider its SDLC reads from may be unreachable."
          onRetry={() => void item.refetch()}
          retryLabel="Reload this item"
        />
      </section>
    );
  }

  if (item.isError || item.data === undefined) {
    return (
      <section className="detail">
        {back}
        <ErrorState
          title="This work item could not be loaded"
          message={
            item.error instanceof Error
              ? item.error.message
              : 'The item failed to load for an unrecorded reason.'
          }
          onRetry={() => void item.refetch()}
          retryLabel="Reload this item"
        />
      </section>
    );
  }

  if (!item.data.ok) {
    return (
      <section className="detail">
        {back}
        <ErrorState
          title="This work item could not be loaded"
          message={item.data.message}
          onRetry={() => void item.refetch()}
          retryLabel="Reload this item"
        />
      </section>
    );
  }

  const detail = item.data.value;
  const { item: summary, states } = detail;

  if (states.length === 0) {
    return (
      <section className="detail">
        {back}
        <EmptyState
          title="This item’s SDLC declares no states"
          body={`${summary.sdlcName} loaded successfully but enumerates no lifecycle states, so there is nothing to lay out for ${summary.key}.`}
          hint="A lifecycle manifest with no states is almost always a packaging mistake. Check the SDLC package this repository is associated with."
          action={{ label: 'Review repositories', to: '/repositories' }}
        />
      </section>
    );
  }

  const unmapped = isUnmapped(summary.stateId);
  const recorded = summary.rawState === '' ? '(no value recorded)' : summary.rawState;
  const selected = selectedStateId(detail, search.get(PARAM_STATE));

  return (
    <section className={unmapped ? 'detail detail--unmapped' : 'detail'} aria-labelledby={headingId}>
      {back}

      <header className="detail__head">
        <p className="detail__key">{summary.key}</p>
        <h1 className="detail__title" id={headingId}>
          {summary.title}
        </h1>

        <p className="detail__meta">
          <span className="detail__fact">
            <span className="detail__fact-label">SDLC</span>
            <span className="detail__fact-value">{summary.sdlcName}</span>
          </span>
          <span className="detail__fact">
            <span className="detail__fact-label">Repository</span>
            <span className="detail__fact-value">{summary.repositoryName}</span>
          </span>
          <span className="detail__fact">
            <span className="detail__fact-label">State</span>
            {unmapped ? (
              <span className="detail__fact-value">
                <span className="tag tag--unmapped">Unmapped</span>
                <code className="detail__raw">{recorded}</code>
              </span>
            ) : (
              <span className="detail__fact-value">{summary.stateName ?? recorded}</span>
            )}
          </span>
          <span className="detail__fact">
            <span className="detail__fact-label">Last reconciled</span>
            <span className="detail__fact-value">
              <time dateTime={summary.reconciledAt}>{formatTimestamp(summary.reconciledAt)}</time>
            </span>
          </span>
        </p>

        {summary.attention === null ? null : (
          <p className="detail__attention">
            <AttentionBadge signal={summary.attention} />
          </p>
        )}

        {summary.freshness === 'fresh' ? null : (
          <p className="detail__note detail__note--stale">
            <span className="tag tag--stale">Stale</span>{' '}
            <span>{stalenessCopy(summary.freshness)}</span>{' '}
            <button
              className="button button--small"
              type="button"
              onClick={() => refresh.mutate({ itemKey: summary.key })}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? 'Retrying…' : 'Retry'}
              <span className="sr-only"> reconciling {summary.key}</span>
            </button>
          </p>
        )}
      </header>

      {/* FR-046, FR-005. Stated before the tabs, because it changes how every
          marker below should be read: none of these states is where the item is. */}
      {unmapped ? (
        <p className="detail__note detail__note--unmapped" role="status">
          The value <code className="detail__raw">{recorded}</code> recorded for {summary.key} has
          no matching state in the version of {summary.sdlcName} this repository follows — most
          often because the package was upgraded while the item was in flight. It is shown exactly
          as recorded rather than mapped to the nearest state, so no tab below is marked as the one
          it occupies. The item is still tracked, and nothing about it has been reassigned.
        </p>
      ) : null}

      <StateTabs
        states={states}
        value={selected}
        onValueChange={onStateChange}
        label={`States of ${summary.sdlcName}`}
        renderPanel={(state) => (
          <StatePanel itemKey={summary.key} state={state} itemAttention={summary.attention} />
        )}
      />
    </section>
  );
}
