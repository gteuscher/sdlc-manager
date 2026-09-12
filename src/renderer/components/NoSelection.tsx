/**
 * T014 — the detail pane with nothing selected (FR-006).
 *
 * Principle X: "a component that can render 'nothing' for any reason must render
 * a deliberate 'nothing', not a blank frame." Half the workbench is empty every
 * time the application opens, so this is the most-seen empty state in the product
 * and the one least excusable as a blank column.
 *
 * It is a separate component rather than a branch inside `ItemDetail` for a
 * reason Principle XII cares about: `ItemDetail` is the lazy boundary that keeps
 * `react-markdown` and its sanitiser — some 50 KB gzipped — out of the initial
 * bundle. If the no-selection copy lived inside it, the first paint of an
 * application with nothing selected would pull the markdown chunk down to render
 * a paragraph.
 *
 * The copy says what selecting will do, rather than announcing that nothing is
 * selected — which the engineer can already see.
 */

import { useId } from 'react';
import type { ReactElement } from 'react';

export function NoSelection(): ReactElement {
  const headingId = useId();

  return (
    <section className="no-selection" aria-labelledby={headingId}>
      <h1 className="no-selection__title" id={headingId}>
        Choose a work item to read it here
      </h1>
      <p className="no-selection__body">
        Selecting an item from the list opens it in this pane — the states its SDLC declares, how
        far the item has travelled through them, the gates on each one, and the artifacts behind
        them. The list stays where it is, so whatever else is waiting on you remains in view.
      </p>
      <p className="no-selection__hint">
        Items needing your attention are listed first. Nothing is selected yet, so nothing has been
        read from any system of record for this pane.
      </p>
    </section>
  );
}
