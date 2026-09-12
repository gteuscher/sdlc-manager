/**
 * T065, T070, T071 — User Story 1: every active item, attention first.
 *
 * Three decisions in here are worth stating, because each one is a requirement
 * rather than a preference.
 *
 * **The filter lives in the URL.** `useSearchParams` is the whole of it: there is
 * no store, no context, no module-level variable (Principle XIII, and there is no
 * global client store in v1.0). A filtered view is therefore a link — shareable,
 * bookmarkable, and restored by the back button for free. The URL is also the
 * only place the filter *can* live and still survive the change events that
 * refetch this list without a restart (FR-010).
 *
 * **Filtering happens here, over the whole list, not across the bridge.** The
 * bridge accepts an `ItemFilter` and the main process honours it, but this route
 * asks for everything and narrows it locally, for two reasons. The filter options
 * themselves are derived from the items — ask for a filtered list and the option
 * sets collapse to whatever survived the last filter, so a repository could never
 * be selected back. And search is per-keystroke; a round trip per keystroke would
 * be a poll of every provider to answer a question already in memory. SC-008's
 * 200 items across 3 repositories is a trivial array for this to work over.
 *
 * **Nothing here knows a state name.** Every option, label, and grouping is read
 * from the summaries the main process resolved against each repository's own
 * loaded definition (Principle II, SC-003, SC-010). Two repositories on different
 * lifecycles land in one list without this file being told either lifecycle
 * exists.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { isUnmapped } from '@core/model/observed';
import type { WorkItemSummary } from '@core/model/observed';

import { AttentionCount } from '../components/AttentionCount';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { ItemFilters, isFiltered } from '../components/ItemFilters';
import type { FilterOption, ItemFilterValue } from '../components/ItemFilters';
import { ItemRow } from '../components/ItemRow';
import { REQUEST_CEILING_MS } from '../query/client';
import { useItems, useRefresh, useRepositories } from '../query/hooks';

const PARAM_REPOSITORY = 'repository';
const PARAM_SDLC = 'sdlc';
const PARAM_STATE = 'state';
const PARAM_SEARCH = 'q';

const REPOSITORIES_ROUTE = '/repositories';

/** Where an engineer registers a repository. The list has no capability of its own to offer. */
const REGISTER_ACTION = { label: 'Register a repository', to: REPOSITORIES_ROUTE };

function distinct(
  items: readonly WorkItemSummary[],
  pick: (item: WorkItemSummary) => FilterOption,
): FilterOption[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const option = pick(item);
    if (!seen.has(option.id)) seen.set(option.id, option.label);
  }
  return [...seen]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function matches(item: WorkItemSummary, filter: ItemFilterValue): boolean {
  if (filter.repositoryId !== '' && item.repositoryId !== filter.repositoryId) return false;
  if (filter.packageId !== '' && item.packageId !== filter.packageId) return false;
  if (filter.stateId !== '' && item.stateId !== filter.stateId) return false;

  const needle = filter.search.trim().toLowerCase();
  if (needle === '') return true;
  return (
    item.key.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle)
  );
}

function needsAttention(item: WorkItemSummary): boolean {
  return item.attention !== null;
}

/**
 * FR-008. A stable partition rather than a comparator: items keep the order the
 * main process gave them within each group, so a list that is refetched every
 * few seconds does not reshuffle under the cursor.
 */
function attentionFirst(items: readonly WorkItemSummary[]): WorkItemSummary[] {
  return [...items.filter(needsAttention), ...items.filter((item) => !needsAttention(item))];
}

export function Items(): ReactElement {
  const headingId = useId();
  const [params, setParams] = useSearchParams();

  const items = useItems();
  const repositories = useRepositories();
  const refresh = useRefresh();

  const filter = useMemo<ItemFilterValue>(
    () => ({
      repositoryId: params.get(PARAM_REPOSITORY) ?? '',
      packageId: params.get(PARAM_SDLC) ?? '',
      stateId: params.get(PARAM_STATE) ?? '',
      search: params.get(PARAM_SEARCH) ?? '',
    }),
    [params],
  );

  const setFilter = useCallback(
    (next: ItemFilterValue) => {
      const updated = new URLSearchParams();
      if (next.repositoryId !== '') updated.set(PARAM_REPOSITORY, next.repositoryId);
      if (next.packageId !== '') updated.set(PARAM_SDLC, next.packageId);
      if (next.stateId !== '') updated.set(PARAM_STATE, next.stateId);
      if (next.search !== '') updated.set(PARAM_SEARCH, next.search);
      // Replace rather than push: typing in the search box must not bury the
      // previous page under one history entry per keystroke.
      setParams(updated, { replace: true });
    },
    [setParams],
  );

  const clearFilter = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  const all = useMemo(() => items.data ?? [], [items.data]);
  const visible = useMemo(
    () => attentionFirst(all.filter((item) => matches(item, filter))),
    [all, filter],
  );

  const attentionTotal = all.filter(needsAttention).length;
  const attentionVisible = visible.filter(needsAttention).length;

  const repositoryOptions = useMemo(
    () =>
      distinct(all, (item) => ({ id: item.repositoryId, label: item.repositoryName })),
    [all],
  );
  const sdlcOptions = useMemo(
    () => distinct(all, (item) => ({ id: item.packageId, label: item.sdlcName })),
    [all],
  );
  const stateOptions = useMemo(
    () =>
      distinct(all, (item) => ({
        id: item.stateId,
        label: isUnmapped(item.stateId)
          ? `Unmapped: ${item.rawState === '' ? '(no value recorded)' : item.rawState}`
          : (item.stateName ?? item.rawState),
      })),
    [all],
  );

  // ── Principle X: no wait without a ceiling ────────────────────────────────
  // The list load and the retry are both provider-bound — the main process has
  // to reach whatever each repository's definition names. Ten seconds is the
  // constitution's default ceiling, after which the wait becomes a rendered
  // failure with a retry rather than an indefinite spinner.
  const listPending = items.isPending;
  const [listTimedOut, setListTimedOut] = useState(false);
  useEffect(() => {
    if (!listPending) {
      setListTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setListTimedOut(true), REQUEST_CEILING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [listPending]);

  const retryingKey = refresh.isPending ? (refresh.variables?.itemKey ?? null) : null;
  const [retryTimedOut, setRetryTimedOut] = useState(false);
  useEffect(() => {
    if (retryingKey === null) {
      setRetryTimedOut(false);
      return;
    }
    setRetryTimedOut(false);
    const timer = window.setTimeout(() => setRetryTimedOut(true), REQUEST_CEILING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [retryingKey]);

  const onRetry = useCallback(
    (key: string) => {
      refresh.mutate({ itemKey: key });
    },
    [refresh],
  );

  const lastRetriedKey = refresh.variables?.itemKey ?? null;
  const retryProblemFor = (key: string): string | null => {
    if (lastRetriedKey !== key) return null;
    if (retryingKey === key) {
      return retryTimedOut
        ? 'Reconciliation has not answered within ten seconds. The source may still be unreachable — you can try again.'
        : null;
    }
    if (refresh.isError) {
      return 'The refresh could not be started. You can try again.';
    }
    const result = refresh.data;
    if (result !== undefined && !result.ok) return result.message;
    return null;
  };

  const noRepositoriesRegistered = repositories.isSuccess && repositories.data.length === 0;

  let content: ReactElement;

  if (listPending && !listTimedOut) {
    content = (
      <p className="pending" role="status">
        Reconciling your work items with their systems of record&hellip;
      </p>
    );
  } else if (listPending) {
    content = (
      <ErrorState
        title="This is taking longer than it should"
        message="The item list has not answered within ten seconds. One of your providers may be unreachable."
        onRetry={() => void items.refetch()}
        retryLabel="Reload the list"
      />
    );
  } else if (items.isError) {
    content = (
      <ErrorState
        title="The item list could not be loaded"
        message={
          items.error instanceof Error
            ? items.error.message
            : 'The item list failed for an unrecorded reason.'
        }
        onRetry={() => void items.refetch()}
        retryLabel="Reload the list"
      />
    );
  } else if (all.length === 0 && noRepositoriesRegistered) {
    // The zero-config first run (Principle I, FR-035, SC-006). It is the first
    // thing a new installation shows, so it says what the application does, why
    // it is empty, and that nothing needs configuring before registering.
    content = (
      <EmptyState
        title="No repositories registered yet"
        body="SDLC Manager reads your work items out of the repositories you register, following whichever SDLC package each one uses. Nothing is registered yet, so there is nothing to track."
        hint={
          'Register a repository and point it at an SDLC package already installed on this machine. ' +
          'No credentials are needed to start — you are asked for one only when a repository’s ' +
          'SDLC names a provider that requires it.'
        }
        action={REGISTER_ACTION}
      />
    );
  } else if (all.length === 0) {
    content = (
      <EmptyState
        title="No active work items"
        body="Your registered repositories reported nothing in flight. Items appear here as soon as their system of record shows them."
        hint="If you expected something here, check the repository's configuration and its provider status."
        action={{ label: 'Review repositories', to: REPOSITORIES_ROUTE }}
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        title="No items match these filters"
        body={`None of the ${all.length} active items match the current repository, SDLC, state, and search filters.`}
        hint="Clear the filters to see everything again."
      />
    );
  } else {
    content = (
      <ul className="items__list">
        {visible.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            onRetry={onRetry}
            retrying={retryingKey === item.key && !retryTimedOut}
            retryProblem={retryProblemFor(item.key)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="items" aria-labelledby={headingId}>
      <div className="items__header">
        <h1 className="items__heading" id={headingId}>
          Work items
        </h1>
        {all.length === 0 ? null : (
          <AttentionCount
            count={attentionVisible}
            hiddenByFilters={attentionTotal - attentionVisible}
          />
        )}
      </div>

      {all.length === 0 && !isFiltered(filter) ? null : (
        <ItemFilters
          repositories={repositoryOptions}
          sdlcs={sdlcOptions}
          states={stateOptions}
          value={filter}
          onChange={setFilter}
          onClear={clearFilter}
        />
      )}

      {content}
    </section>
  );
}
