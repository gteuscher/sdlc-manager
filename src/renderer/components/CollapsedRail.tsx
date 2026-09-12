/**
 * T027 — what a collapsed list pane still says (FR-009).
 *
 * "A collapsed pane still reports that items need attention, and how many"
 * ([contracts/workbench-layout.md](../../../specs/003-two-pane-workbench/contracts/workbench-layout.md) §4).
 * A rail that hid the one signal the workbench exists to surface would have
 * defeated its own purpose: the engineer would gain some width and silently stop
 * being told when something started waiting on them.
 *
 * **Why this is its own component rather than three lines inside the shell.**
 * plan.md's Structure Decision keeps `Workbench.tsx` to arrangement — a grid, a
 * toggle, and an outlet — and its stated failure mode is a shell that accumulates
 * the responsibilities of both children. Reporting attention needs the item list,
 * so the read lives here and the shell only places it. The boundary test still
 * holds: deleting the workbench restores two routes without either pane changing.
 *
 * **The count is deliberately unfiltered.** `Items` reports the filtered count
 * with a suffix naming what the filters hide, which is right when the filter
 * controls are on screen and the engineer can act on them. Collapsed, they are
 * not: a rail reading "nothing needs your attention" because of a filter the
 * engineer cannot currently see would be the worst kind of wrong — it would tell
 * them to stop looking. So this reports every active item needing attention, and
 * `hiddenByFilters` is zero because nothing is being hidden from *this* number.
 *
 * Nothing is fetched for it. `useItems()` is the same query the list pane already
 * subscribes to; this is a read of the shared cache, not a second round trip.
 */

import type { ReactElement } from 'react';

import { AttentionCount } from './AttentionCount';
import { useItems } from '../query/hooks';

export function CollapsedRail(): ReactElement | null {
  const items = useItems();

  // Before the first answer there is no honest number to give, and a count that
  // guessed zero would be a claim the application cannot prove (Principle X).
  // The rail simply says nothing until it can say something true.
  if (!items.isSuccess) return null;

  const needing = items.data.filter((item) => item.attention !== null).length;

  return (
    <div className="collapsed-rail">
      <AttentionCount count={needing} hiddenByFilters={0} />
    </div>
  );
}
