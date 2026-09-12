/**
 * The last line of Principle X.
 *
 * "A component that can render 'nothing' for any reason must render a deliberate
 * 'nothing', not a blank frame." Without a boundary, a single thrown render —
 * most plausibly a lazily-loaded route whose chunk could not be fetched —
 * unmounts the entire React tree. The window goes blank, the navigation
 * disappears with everything else, and the engineer cannot even leave the view
 * that failed. That is the worst available outcome: no information and no way
 * out.
 *
 * This is a class component because React offers no hook equivalent of
 * `componentDidCatch`. That is the whole reason; nothing else here needs a class.
 *
 * It deliberately wraps the routed outlet rather than the whole application, so
 * the header and its navigation survive a route failure and remain usable. Being
 * able to click away is most of the recovery.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  /** Changes when the route does, so navigating away clears a previous failure. */
  readonly resetKey: string;
}

interface State {
  readonly error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(previous: Props): void {
    // A new route is a fresh attempt: a failure in one view must not persist
    // into the next one the engineer visits.
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The renderer has no logging capability of its own — it cannot write a file
    // or open a connection (ipc-surface.md §4) — so the console is where this
    // goes. In development that is the terminal running `npm run dev`.
    console.error('This view failed to render:', error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return <RouteFailure error={error} onRetry={this.retry} />;
  }
}

function RouteFailure({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  // A chunk that could not be fetched is by far the likeliest cause and has a
  // different remedy from a genuine bug, so it is named separately.
  const looksLikeChunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
    error.message,
  );

  return (
    <section className="route-error" role="alert">
      <h1 className="route-error__title">This view could not be displayed</h1>
      <p className="route-error__lead">
        {looksLikeChunk
          ? 'Part of the interface could not be loaded. This usually means the application was rebuilt while it was open.'
          : 'Something in this view failed while rendering. The rest of the application is unaffected.'}
      </p>
      <p className="route-error__detail">{error.message}</p>
      <p className="route-error__actions">
        <button type="button" className="button" onClick={onRetry}>
          Try this view again
        </button>{' '}
        <button type="button" className="button button--quiet" onClick={() => window.location.reload()}>
          Reload the application
        </button>
      </p>
      <p className="route-error__hint">
        The navigation above still works, so you can move to another view without reloading.
      </p>
    </section>
  );
}
