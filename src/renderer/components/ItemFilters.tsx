/**
 * T068 — filter by repository, by SDLC, and by state, and search by identifier
 * or title (FR-004).
 *
 * This component holds no state. `value` comes in and `onChange` goes out, so
 * the filter lives wherever the route decides to put it — which is the URL
 * (Principle XIII). That also makes the whole control surface testable by
 * rendering it with a value and asserting what comes back.
 *
 * Every option is supplied by the caller, derived at runtime from the loaded
 * definitions. Nothing here knows the name of a single state, SDLC, or provider
 * (Principle II, SC-010) — a lifecycle the application has never seen populates
 * these selects exactly as well as a familiar one.
 *
 * Native `<select>` and `<input type="search">` rather than a headless
 * primitive: both are already keyboard-operable and correctly named, so a
 * dependency here would buy nothing and cost bundle budget (Principles XI, XII).
 */

import { useId } from 'react';
import type { ReactElement } from 'react';

export interface FilterOption {
  readonly id: string;
  readonly label: string;
}

/** Empty string means "no filter", for every field. */
export interface ItemFilterValue {
  readonly repositoryId: string;
  readonly packageId: string;
  readonly stateId: string;
  readonly search: string;
  /**
   * 004. Whether work the lifecycle considers finished is included. `false` — the
   * quieter default — is what keeps the list bounded for someone who has never
   * heard of this feature.
   *
   * It belongs in this shape rather than beside it because it *is* a filter: it
   * narrows or widens the same list, it is cleared by "Clear filters" along with
   * the rest, and it travels in the address the same way. Treating it as a
   * separate kind of thing is how it would end up written by a code path that
   * forgets the others exist.
   */
  readonly finished: boolean;
}

export interface ItemFiltersProps {
  readonly repositories: readonly FilterOption[];
  readonly sdlcs: readonly FilterOption[];
  readonly states: readonly FilterOption[];
  readonly value: ItemFilterValue;
  readonly onChange: (next: ItemFilterValue) => void;
  readonly onClear: () => void;
}

export function isFiltered(value: ItemFilterValue): boolean {
  return (
    value.repositoryId !== '' ||
    value.packageId !== '' ||
    value.stateId !== '' ||
    value.search.trim() !== '' ||
    // 004. Including finished work is a departure from the default view, so
    // "Clear filters" must undo it along with everything else — otherwise the
    // one control that promises to restore the ordinary list would leave the
    // list larger than it found it.
    value.finished
  );
}

export function ItemFilters({
  repositories,
  sdlcs,
  states,
  value,
  onChange,
  onClear,
}: ItemFiltersProps): ReactElement {
  const repositoryId = useId();
  const sdlcId = useId();
  const stateId = useId();
  const searchId = useId();
  const finishedId = useId();

  return (
    <div className="filters">
      <div className="filters__field">
        <label className="filters__label" htmlFor={repositoryId}>
          Repository
        </label>
        <select
          className="filters__control"
          id={repositoryId}
          value={value.repositoryId}
          onChange={(event) => onChange({ ...value, repositoryId: event.target.value })}
        >
          <option value="">All repositories</option>
          {repositories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="filters__field">
        <label className="filters__label" htmlFor={sdlcId}>
          SDLC
        </label>
        <select
          className="filters__control"
          id={sdlcId}
          value={value.packageId}
          onChange={(event) => onChange({ ...value, packageId: event.target.value })}
        >
          <option value="">All SDLCs</option>
          {sdlcs.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="filters__field">
        <label className="filters__label" htmlFor={stateId}>
          State
        </label>
        <select
          className="filters__control"
          id={stateId}
          value={value.stateId}
          onChange={(event) => onChange({ ...value, stateId: event.target.value })}
        >
          <option value="">All states</option>
          {states.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="filters__field filters__field--wide">
        <label className="filters__label" htmlFor={searchId}>
          Search
        </label>
        <input
          className="filters__control"
          id={searchId}
          type="search"
          placeholder="Identifier or title"
          value={value.search}
          onChange={(event) => onChange({ ...value, search: event.target.value })}
        />
      </div>

      {/* 004, FR-002. The list withholds finished work by default, and this is
          the only thing that says so — hence a persistent checkbox rather than
          something behind a menu. Note what the label does *not* claim: it says
          finished work can be shown, never that any exists. The renderer cannot
          know whether it does without fetching the very thing it is withholding
          (research.md §5), and a control promising finished work would be lying
          in every repository that has none. */}
      <div className="filters__field filters__field--check">
        <label className="filters__check" htmlFor={finishedId}>
          <input
            className="filters__checkbox"
            id={finishedId}
            type="checkbox"
            checked={value.finished}
            onChange={(event) => onChange({ ...value, finished: event.target.checked })}
          />
          <span>Show finished work</span>
        </label>
      </div>

      <div className="filters__field filters__field--action">
        <button
          className="button button--quiet"
          type="button"
          onClick={onClear}
          disabled={!isFiltered(value)}
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}
