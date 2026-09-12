/**
 * Principle X's other half: "no error state without a retry path".
 *
 * `onRetry` is required for exactly that reason. A failure the engineer can only
 * look at is a dead end, and every failure this renderer can show — a provider
 * that did not answer, a reconciliation that timed out — is one a retry can
 * plausibly clear (FR-037).
 *
 * `message` is expected to be actionable: what failed and what to do next
 * (Principle V). The typed failures crossing the bridge already carry that text,
 * so callers pass it straight through rather than inventing their own.
 */

import { useId } from 'react';
import type { ReactElement } from 'react';

export interface ErrorStateProps {
  readonly title: string;
  readonly message: string;
  readonly onRetry: () => void;
  readonly retryLabel?: string;
  readonly retrying?: boolean;
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
}: ErrorStateProps): ReactElement {
  const headingId = useId();

  return (
    <section className="failure" role="alert" aria-labelledby={headingId}>
      <h2 className="failure__title" id={headingId}>
        {title}
      </h2>
      <p className="failure__message">{message}</p>
      <button className="button" type="button" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : retryLabel}
      </button>
    </section>
  );
}
