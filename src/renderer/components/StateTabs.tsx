/**
 * T079 — the states of an item's SDLC, as an ordered set of tabs (FR-011).
 *
 * Radix Tabs rather than a hand-built control, for one reason the constitution
 * states directly: Story 2's core interaction *is* a tab set, and the WAI-ARIA
 * tabs pattern — `role="tablist"`, roving `tabindex`, arrow-key movement between
 * triggers, Home/End, and the trigger-to-panel `aria-controls` relationship — is
 * the single largest chunk of Principle XI's obligation. It is obtained here
 * rather than reimplemented, because hand-rolling focus management is precisely
 * the risk the constitution's scope note on Principle XI says not to take.
 *
 * Everything rendered comes from `states`. The order is the manifest's `ordinal`
 * and nothing else; the labels are the definition's own names; the count is
 * however many the definition declares. No state name appears in this file, and
 * none can: a lifecycle this application has never seen renders here exactly as
 * well as a familiar one (FR-016, SC-003, SC-010).
 *
 * Only the selected tab's panel is mounted — Radix unmounts the rest. That is
 * what keeps a six-state item from issuing six states' worth of artifact reads
 * on open, and it is half of FR-021's answer.
 *
 * The component is fully controlled: `value` comes in and `onValueChange` goes
 * out, so the selected tab lives wherever the route decides to put it — which is
 * the URL (FR-015, Principle XIII). It holds no state of its own.
 */

import type { ReactElement, ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';

import type { StateView } from '@core/model/observed';

import { StateMarker } from './StateMarker';

export interface StateTabsProps {
  /** Every state the loaded definition declares, in any order; rendered by `ordinal`. */
  readonly states: readonly StateView[];
  /** The state id whose tab is selected. */
  readonly value: string;
  readonly onValueChange: (stateId: string) => void;
  /** Names the tab list for assistive technology, e.g. the lifecycle's own name. */
  readonly label: string;
  /** The panel for one state. Called only for the selected tab, because only it is mounted. */
  readonly renderPanel: (state: StateView) => ReactNode;
}

export function StateTabs({
  states,
  value,
  onValueChange,
  label,
  renderPanel,
}: StateTabsProps): ReactElement {
  // `ordinal` is the manifest's only ordering source (data-model). Sorting a copy
  // keeps this component indifferent to the order the main process happened to
  // serialise them in.
  const ordered = [...states].sort((left, right) => left.ordinal - right.ordinal);

  return (
    <Tabs.Root className="tabs" value={value} onValueChange={onValueChange}>
      <Tabs.List className="tabs__list" aria-label={label}>
        {ordered.map((state) => (
          <Tabs.Trigger className="tabs__trigger" key={state.id} value={state.id}>
            {/* The marker's word is assistive-only here so the state's own name
                stays the scannable thing, but it is still read aloud, so the two
                cues never collapse to colour alone. */}
            <StateMarker progress={state.progress} showLabel={false} />
            <span className="tabs__name">{state.name}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {ordered.map((state) => (
        <Tabs.Content className="tabs__panel" key={state.id} value={state.id}>
          {renderPanel(state)}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
