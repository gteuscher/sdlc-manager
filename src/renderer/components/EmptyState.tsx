/**
 * Principle X's deliberate "nothing".
 *
 * "No empty state without copy" is the rule, so copy is a required prop rather
 * than an optional one: a caller cannot render this component and produce a
 * blank frame. The optional action is a route link, because the renderer has no
 * capability of its own to offer — every action it can present is somewhere else
 * in this application (FR-034a).
 */

import { useId } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

export interface EmptyStateAction {
  readonly label: string;
  readonly to: string;
}

export interface EmptyStateProps {
  readonly title: string;
  /** Why there is nothing here. Required — this is the rule, not a decoration. */
  readonly body: string;
  /** What the engineer can do about it, when that needs more than a link label. */
  readonly hint?: string;
  readonly action?: EmptyStateAction;
}

export function EmptyState({ title, body, hint, action }: EmptyStateProps): ReactElement {
  const headingId = useId();

  return (
    <section className="empty" aria-labelledby={headingId}>
      <h2 className="empty__title" id={headingId}>
        {title}
      </h2>
      <p className="empty__body">{body}</p>
      {hint === undefined ? null : <p className="empty__hint">{hint}</p>}
      {action === undefined ? null : (
        <Link className="button button--primary" to={action.to}>
          {action.label}
        </Link>
      )}
    </section>
  );
}
