/**
 * A failing view must not take the application with it (Principle X).
 *
 * This guards a failure an engineer actually hit: clicking through to a view
 * produced a blank window with no navigation and no way back. The cause was a
 * lazily-loaded route whose chunk could not be fetched after a rebuild, and the
 * absence of any boundary meant one thrown render unmounted everything.
 *
 * The assertions below are about what survives, not about the error text: the
 * navigation stays usable, the failure is announced, and there is a way forward.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { ReactElement } from 'react';

import { RouteErrorBoundary } from '@renderer/components/RouteErrorBoundary';

function Exploding({ message }: { message: string }): ReactElement {
  throw new Error(message);
}

function Working(): ReactElement {
  return <p>The view rendered.</p>;
}

beforeEach(() => {
  // React logs a caught error; the noise is expected and not the subject.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a view that throws', () => {
  it('renders a deliberate failure rather than nothing', () => {
    render(
      <RouteErrorBoundary resetKey="/repositories">
        <Exploding message="kaboom" />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/could not be displayed/i)).toBeDefined();
  });

  it('announces the failure, so it is not merely visible', () => {
    render(
      <RouteErrorBoundary resetKey="/repositories">
        <Exploding message="kaboom" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('offers a way forward rather than a dead end', () => {
    render(
      <RouteErrorBoundary resetKey="/repositories">
        <Exploding message="kaboom" />
      </RouteErrorBoundary>,
    );

    // Principle X: no error state without a retry path.
    expect(screen.getByRole('button', { name: /try this view again/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /reload the application/i })).toBeDefined();
  });

  it('names a failed chunk differently from a render bug, because the remedy differs', () => {
    render(
      <RouteErrorBoundary resetKey="/repositories">
        <Exploding message="Failed to fetch dynamically imported module: /src/routes/Repositories.tsx" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/rebuilt while it was open/i)).toBeDefined();
  });

  it('reports what actually failed', () => {
    render(
      <RouteErrorBoundary resetKey="/repositories">
        <Exploding message="a very specific problem" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(/a very specific problem/)).toBeDefined();
  });

  it('recovers when the engineer navigates to another view', () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="/repositories">
        <Exploding message="kaboom" />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();

    // A different route is a fresh attempt — the previous failure must not stick.
    rerender(
      <RouteErrorBoundary resetKey="/">
        <Working />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('The view rendered.')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lets the engineer retry the same view in place', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;

    function Flaky(): ReactElement {
      if (shouldThrow) throw new Error('kaboom');
      return <p>Recovered.</p>;
    }

    render(
      <RouteErrorBoundary resetKey="/repositories">
        <Flaky />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try this view again/i }));

    expect(screen.getByText('Recovered.')).toBeDefined();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <RouteErrorBoundary resetKey="/repositories">
        <Exploding message="kaboom" />
      </RouteErrorBoundary>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('a view that works', () => {
  it('renders untouched', () => {
    render(
      <RouteErrorBoundary resetKey="/">
        <Working />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('The view rendered.')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
