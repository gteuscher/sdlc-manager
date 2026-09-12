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
 * **It does not know it is a pane (003).** The workbench mounts this component
 * beside a detail pane, and nothing below changed to accommodate that: no width,
 * no layout, no awareness of what is on the other side. The one thing it gained
 * is `selectedKey` — which row the engineer is currently reading — and that is
 * not knowledge of another component, it is a property of a list. A list has to
 * know which of its rows is current in order to mark it (FR-005), and it has to
 * know in order to say so when its own filters have excluded it (FR-015).
 *
 * The prop is optional and defaults to "nothing selected", so the list renders
 * exactly as it always did when mounted alone — which is what keeps 001's suite
 * for it passing unedited, and that suite is the whole regression net for FR-021.
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
/** 004. The fifth key this list owns. See `FILTER_PARAMS` — it must be in that set. */
const PARAM_FINISHED = 'finished';

/**
 * Every query key the **list** owns, and the exact set `writeFilterKeys` clears
 * before rewriting.
 *
 * This is a named constant rather than an inline array because of what happened
 * in 003: the list rebuilt the whole query string on every filter write and
 * silently deleted the detail pane's `?tab=`. The fix was to touch only the
 * list's own keys — which works right up until someone adds a sixth key and
 * wires it to a control without adding it here. Then it survives filter changes
 * by accident and breaks the first time this code is reordered.
 *
 * **Adding a list filter means adding it to this array.**
 */
const FILTER_PARAMS = [
  PARAM_REPOSITORY,
  PARAM_SDLC,
  PARAM_STATE,
  PARAM_SEARCH,
  PARAM_FINISHED,
] as const;

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

export interface ItemsProps {
  /**
   * The key of the item open in the detail pane, or null when nothing is
   * selected. Supplied by the workbench, which reads it off the route; the list
   * never reads the route itself, and neither does a row (Principle VIII).
   */
  readonly selectedKey?: string | null;
}

export function Items({ selectedKey = null }: ItemsProps): ReactElement {
  const headingId = useId();
  const [params, setParams] = useSearchParams();

  // The filter is read before the queries, because since 004 one of its values
  // decides what the item query asks for.
  const filter = useMemo<ItemFilterValue>(
    () => ({
      repositoryId: params.get(PARAM_REPOSITORY) ?? '',
      packageId: params.get(PARAM_SDLC) ?? '',
      stateId: params.get(PARAM_STATE) ?? '',
      search: params.get(PARAM_SEARCH) ?? '',
      // Present and '1' means yes; anything else, including absent, means no.
      // The default is the quieter one, and an address that says nothing about
      // finished work gets the bounded list (FR-007).
      finished: params.get(PARAM_FINISHED) === '1',
    }),
    [params],
  );

  // 004. Only the request that wants finished work asks for it, so the default
  // payload stays bounded — finished work only accumulates, and shipping all of
  // it on every reconciliation in order to hide it would re-create the problem
  // this feature exists to solve (research.md §2).
  //
  // `undefined` rather than an empty object when off, deliberately: it keeps the
  // query key byte-identical to the one `CollapsedRail` subscribes to, so the two
  // share a single fetch in the ordinary case.
  const items = useItems(filter.finished ? { includeTerminal: true } : undefined);
  const repositories = useRepositories();
  const refresh = useRefresh();

  /**
   * 003 — the list writes **only its own four keys**, and leaves the rest of the
   * query string exactly as it found it.
   *
   * This used to build a fresh `URLSearchParams` and hand it over whole, which
   * was correct while the list was a page: it owned its URL, and there was
   * nothing else in the query string to lose. As a pane it shares one URL with
   * the detail beside it, and replacing the whole query string deleted the
   * detail's `?tab=` on every filter change and every keystroke in the search
   * box — the open item silently jumped back to the state it occupies.
   *
   * That is the *second half* of the collision research.md §2 describes. Renaming
   * the detail's parameter stopped the tab from filtering the list; it did not
   * stop the list from erasing the tab, because the two halves fail through
   * different code. Both directions were required — FR-013 for the filter and
   * 001's FR-015 for the tab — so neither may clobber the other.
   *
   * Every filter key is deleted before the surviving ones are set, so clearing a
   * single select removes its key rather than leaving a stale value behind.
   */
  const writeFilterKeys = useCallback(
    (mutate: (into: URLSearchParams) => void) => {
      const updated = new URLSearchParams(params);
      for (const key of FILTER_PARAMS) {
        updated.delete(key);
      }
      mutate(updated);
      // Replace rather than push: typing in the search box must not bury the
      // previous page under one history entry per keystroke.
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  const setFilter = useCallback(
    (next: ItemFilterValue) => {
      writeFilterKeys((updated) => {
        if (next.repositoryId !== '') updated.set(PARAM_REPOSITORY, next.repositoryId);
        if (next.packageId !== '') updated.set(PARAM_SDLC, next.packageId);
        if (next.stateId !== '') updated.set(PARAM_STATE, next.stateId);
        if (next.search !== '') updated.set(PARAM_SEARCH, next.search);
        // Absent rather than `finished=0` when off, so the ordinary view has an
        // ordinary address and a shared link carries no dead weight.
        if (next.finished) updated.set(PARAM_FINISHED, '1');
      });
    },
    [writeFilterKeys],
  );

  /** Clears the filters and nothing else — the open item's tab is not a filter. */
  const clearFilter = useCallback(() => {
    writeFilterKeys(() => undefined);
  }, [writeFilterKeys]);

  /**
   * 004 — the query string a row's link carries, so selecting an item does not
   * silently rearrange the list you selected it from.
   *
   * Only the keys the list owns travel. The detail's `?tab=` is deliberately
   * dropped: a tab belongs to the item being read, and inheriting the previous
   * item's tab would be a claim about a lifecycle this one may not share.
   *
   * This is the mirror of `writeFilterKeys`, and between them they state the
   * whole rule: **the list writes only its own keys, and carries only its own
   * keys.** 003 got the first half right and shipped the second half broken,
   * because a `<Link>` with a string `to` discards a query string quietly.
   */
  const listSearch = useMemo(() => {
    const kept = new URLSearchParams();
    for (const key of FILTER_PARAMS) {
      const value = params.get(key);
      if (value !== null) kept.set(key, value);
    }
    const text = kept.toString();
    return text === '' ? '' : `?${text}`;
  }, [params]);

  const all = useMemo(() => items.data ?? [], [items.data]);
  const visible = useMemo(
    () => attentionFirst(all.filter((item) => matches(item, filter))),
    [all, filter],
  );

  const attentionTotal = all.filter(needsAttention).length;
  const attentionVisible = visible.filter(needsAttention).length;

  // FR-015, and data-model.md §"Derived, not stored". Whether the open item is
  // among the listed ones is a function of the selection and the current filters,
  // recomputed on every render. Remembering "the selection was excluded" would be
  // wrong the moment the filter changed again, and there is no cheaper way to be
  // reliably right than to ask the question each time.
  //
  // The two conditions are kept apart deliberately: an item that is not in `all`
  // has not been excluded by a filter — it has not loaded, or no longer exists —
  // and saying "your filters are hiding it" would be a guess (Principle X).
  const selectionExists = selectedKey !== null && all.some((item) => item.key === selectedKey);
  const selectionExcluded =
    selectionExists && !visible.some((item) => item.key === selectedKey);

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

  /**
   * 004 — the filter bar is withheld only when it could do nothing useful.
   *
   * It used to be withheld whenever the list was empty, which was right while an
   * empty list meant "there is nothing here". Since 004 an empty list is often
   * empty *because* finished work is hidden — and the control that reveals it
   * lives in this bar. Suppressing it there produced a genuine dead end: the
   * empty state told the engineer to show finished work while removing the only
   * control that could, leaving a hand-edited address as the sole way out, which
   * SC-001 explicitly promises against.
   *
   * Three states still withhold it, because in each there is nothing to reveal
   * and a row of empty selects would be noise: before the first answer arrives,
   * after a failed load, and on the genuine first run with nothing registered.
   */
  const offerFilters =
    isFiltered(filter) ||
    (!listPending && !items.isError && !(all.length === 0 && noRepositoriesRegistered));

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
        hint={
          // 004. "Nothing in flight" and "nothing here" are different facts, and
          // an engineer who cannot tell them apart may conclude their repository
          // is broken. This does not claim finished work exists — it cannot know
          // that without asking for it (FR-002) — it says where to look.
          filter.finished
            ? "If you expected something here, check the repository's configuration and its provider status."
            : 'Work that its lifecycle considers finished is not listed here. Show finished work to see whether these repositories have any, or check the repository’s configuration and its provider status.'
        }
        action={{ label: 'Review repositories', to: REPOSITORIES_ROUTE }}
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        title="No items match these filters"
        // 004. `all` includes finished work whenever it is being shown, so the
        // old wording — "none of the N active items" — counted items the same
        // feature insists are not active.
        body={`None of the ${all.length} ${filter.finished ? 'listed' : 'active'} items match the current repository, SDLC, state, and search filters.`}
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
            selected={item.key === selectedKey}
            search={listSearch}
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

      {offerFilters ? (
        <ItemFilters
          repositories={repositoryOptions}
          sdlcs={sdlcOptions}
          states={stateOptions}
          value={filter}
          onChange={setFilter}
          onClear={clearFilter}
        />
      ) : null}

      {/* FR-015. The detail keeps showing what is being read even when the
          filters no longer list it, and a list that silently dropped the row
          would leave the engineer looking for an item that appears to be gone.
          `role="status"`, because the row vanishes the instant a filter is
          typed and the explanation has to arrive with it. */}
      {selectionExcluded ? (
        <p className="items__excluded" role="status">
          The item open beside this list is not among those shown — the current filters exclude it.
          It is still open, and clearing the filters will bring it back into the list.
        </p>
      ) : null}

      {content}
    </section>
  );
}
