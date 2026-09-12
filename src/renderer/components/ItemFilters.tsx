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
    value.search.trim() !== ''
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
