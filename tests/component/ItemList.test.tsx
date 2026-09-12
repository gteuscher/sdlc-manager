/**
 * T060 — the item list, tested the only way the constitution allows: through
 * rendered output and user interaction. Nothing here reaches into a component's
 * internals or its private state (Principle IV), and nothing here mocks a module
 * belonging to the renderer. The single seam is `window.dashboard`, which is the
 * renderer's entire privilege set (ipc-surface.md §4) — so a component that
 * needed anything else would fail to render here rather than quietly work.
 *
 * The lifecycles below are invented. They have to be: a list tested only against
 * the vocabulary in the specs would prove nothing about SC-003's claim that an
 * unfamiliar SDLC renders correctly. Two repositories on two different lifecycles
 * appear in one list, and no state name in this file appears anywhere in
 * `src/renderer`.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { ReactElement } from 'react';

import { UNMAPPED } from '@core/model/observed';
import type { AttentionSignal, WorkItemSummary } from '@core/model/observed';
import type { Repository } from '@core/model/observed';

import { Items } from '@renderer/routes/Items';
import { createBridgeStub, installBridge, type BridgeStub } from '../support/bridge';

// ── Fixtures ────────────────────────────────────────────────────────────────

const RECONCILED = '2026-09-11T08:30:00.000Z';

function item(overrides: Partial<WorkItemSummary> & { key: string }): WorkItemSummary {
  return {
    title: `Work on ${overrides.key}`,
    repositoryId: 'repo-ledger',
    repositoryName: 'Ledger',
    packageId: 'pkg-ledger',
    sdlcName: 'Ledger lifecycle',
    unit: 'card',
    stateId: 'drafting',
    stateName: 'Drafting',
    rawState: 'drafting',
    attention: null,
    reconciledAt: RECONCILED,
    freshness: 'fresh',
    disagreements: [],
    ...overrides,
  };
}

const inputNeeded: AttentionSignal = {
  kind: 'input_needed',
  reason: 'An agent is waiting on an answer. Reply in the tracker.',
  stateId: 'drafting',
};

const gateFailed: AttentionSignal = {
  kind: 'gate_failed',
  reason: 'The clearance check did not pass. Re-run it where it is configured.',
  stateId: 'clearing',
  gateId: 'clearance',
};

function repository(id: string, name: string): Repository {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    packageId: `pkg-${id}`,
    packageVersion: '1.0.0',
    config: {},
    providerStatus: {},
    availability: 'available',
    problem: null,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

let teardown: (() => void) | undefined;

function mount(stub: BridgeStub, initialEntry = '/'): { container: HTMLElement } {
  teardown = installBridge(stub);
  // A test-local client: the production client retries twice with a backoff,
  // which would turn a failure assertion into a several-second wait.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Items />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { container };
}

/** Renders the current query string, so the URL can be asserted as output rather than as internals. */
function LocationProbe(): ReactElement {
  const location = useLocation();
  return <p data-testid="query-string">{location.search}</p>;
}

/** The rows, in the order they were rendered. */
function renderedKeys(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((row) => within(row).getByRole('link').textContent ?? '');
}

/**
 * Queries scoped to the list itself. The filter selects are populated from the
 * same items, so an unscoped text query would match a row and its own filter
 * option and prove nothing about either.
 */
function list(): ReturnType<typeof within> {
  return within(screen.getByRole('list'));
}

beforeEach(() => {
  teardown = undefined;
});

afterEach(() => {
  teardown?.();
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('the item list', () => {
  it('offers repository registration when nothing is registered, rather than a blank frame', async () => {
    mount(
      createBridgeStub({
        listItems: () => Promise.resolve([]),
        listRepositories: () => Promise.resolve([]),
      }),
    );

    expect(await screen.findByText(/no repositories registered yet/i)).toBeDefined();
    // Principle X: copy, and an action.
    expect(screen.getByText(/reads your work items out of the repositories you register/i)).toBeDefined();
    const action = screen.getByRole('link', { name: /register a repository/i });
    expect(action.getAttribute('href')).toBe('/repositories');
  });

  it('explains an empty list differently when repositories are registered but report nothing', async () => {
    mount(
      createBridgeStub({
        listItems: () => Promise.resolve([]),
        listRepositories: () => Promise.resolve([repository('repo-ledger', 'Ledger')]),
      }),
    );

    expect(await screen.findByText(/no active work items/i)).toBeDefined();
  });

  it('lists items from every repository, each labelled with its own SDLC and state', async () => {
    mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-1' }),
            item({
              key: 'ORB-9',
              repositoryId: 'repo-orbit',
              repositoryName: 'Orbit',
              packageId: 'pkg-orbit',
              sdlcName: 'Orbit lifecycle',
              stateId: 'surveying',
              stateName: 'Surveying',
              rawState: 'surveying',
            }),
          ]),
      }),
    );

    expect(await screen.findByText('LED-1')).toBeDefined();
    expect(list().getByText('ORB-9')).toBeDefined();
    expect(list().getByText('Ledger lifecycle')).toBeDefined();
    expect(list().getByText('Orbit lifecycle')).toBeDefined();
    expect(list().getByText('Drafting')).toBeDefined();
    expect(list().getByText('Surveying')).toBeDefined();
    // FR-002: the reconciled time is on the row.
    expect(screen.getAllByText(/last reconciled/i).length).toBe(2);
  });

  it('orders items needing attention ahead of items progressing normally, and counts them', async () => {
    mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-1' }),
            item({ key: 'LED-2' }),
            item({ key: 'LED-3', attention: gateFailed }),
            item({ key: 'LED-4' }),
            item({ key: 'LED-5', attention: inputNeeded }),
          ]),
      }),
    );

    await screen.findByText('LED-1');

    const order = renderedKeys();
    expect(order[0]).toContain('LED-3');
    expect(order[1]).toContain('LED-5');
    expect(order.slice(2).join(' ')).toContain('LED-1');

    // FR-009.
    expect(screen.getByText(/items need your attention/i)).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
  });

  it('distinguishes awaiting-input from a failed gate by more than colour', async () => {
    const { container } = mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-3', attention: gateFailed }),
            item({ key: 'LED-5', attention: inputNeeded }),
          ]),
      }),
    );

    const awaiting = await screen.findByText(/awaiting your input/i);
    const failed = screen.getByText(/gate failed/i);

    // Different words, which is the cue that survives greyscale and a screen reader.
    expect(awaiting.textContent).not.toBe(failed.textContent);

    // And a different drawn mark, so the two are separable at a glance: a circle
    // for one, a triangular path for the other.
    const badges = container.querySelectorAll('.badge');
    expect(badges.length).toBe(2);
    const marks = [...badges].map((badge) => {
      const svg = badge.querySelector('svg');
      return svg === null ? '' : (svg.firstElementChild?.tagName.toLowerCase() ?? '');
    });
    expect(new Set(marks).size).toBe(2);

    // Each signal's reason is on screen, saying where the action is performed (FR-034a).
    expect(screen.getByText(inputNeeded.reason)).toBeDefined();
    expect(screen.getByText(gateFailed.reason)).toBeDefined();
    // And no control claiming the dashboard can resolve it (FR-034).
    expect(screen.queryByRole('button', { name: /approve|advance|override/i })).toBeNull();
  });

  it('shows an unmapped item with its raw recorded value rather than hiding or coercing it', async () => {
    mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-1' }),
            item({
              key: 'LED-7',
              stateId: UNMAPPED,
              stateName: null,
              rawState: 'Pending Countersign',
            }),
          ]),
      }),
    );

    expect(await screen.findByText('LED-7')).toBeDefined();
    expect(list().getByText('Unmapped')).toBeDefined();
    // The raw value, exactly as recorded, in both the row and its explanation.
    expect(list().getAllByText('Pending Countersign').length).toBeGreaterThan(0);
    expect(list().getByText(/has no matching state in this item/i)).toBeDefined();
    // Still listed alongside everything else.
    expect(screen.getAllByRole('listitem').length).toBe(2);
  });

  it('surfaces a provider disagreement instead of hiding it', async () => {
    mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({
              key: 'LED-8',
              disagreements: [
                {
                  field: 'stateId',
                  winner: 'ledger',
                  winningValue: 'drafting',
                  others: [{ provider: 'memo', value: 'clearing' }],
                },
              ],
            }),
          ]),
      }),
    );

    expect(await screen.findByText(/providers disagree/i)).toBeDefined();
    expect(screen.getByText(/ledger ownership and it reports/i)).toBeDefined();
    expect(screen.getByText(/memo says/i)).toBeDefined();
  });

  it('marks items from a failing provider stale with a retry, leaving healthy items intact', async () => {
    const refreshed: unknown[] = [];
    mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-1' }),
            item({
              key: 'ORB-9',
              repositoryId: 'repo-orbit',
              repositoryName: 'Orbit',
              packageId: 'pkg-orbit',
              sdlcName: 'Orbit lifecycle',
              stateId: 'surveying',
              stateName: 'Surveying',
              rawState: 'surveying',
              freshness: 'unreachable',
            }),
          ]),
        refresh: (scope) => {
          refreshed.push(scope);
          return Promise.resolve({ ok: true as const, value: undefined });
        },
      }),
    );

    await screen.findByText('LED-1');

    // SC-007: the healthy item is untouched and correctly stated.
    const healthy = screen.getAllByRole('listitem')[0];
    expect(healthy).toBeDefined();
    expect(within(healthy as HTMLElement).queryByText(/^stale$/i)).toBeNull();
    expect(list().getByText('Drafting')).toBeDefined();

    // FR-037: the failing one is marked, and offers a retry.
    expect(list().getByText(/^stale$/i)).toBeDefined();
    expect(list().getByText(/could not be reached/i)).toBeDefined();

    const retry = screen.getByRole('button', { name: /retry reconciling ORB-9/i });
    await userEvent.click(retry);

    expect(refreshed).toEqual([{ itemKey: 'ORB-9' }]);
  });

  it('reports a retry that the provider refused, in place, with the retry still available', async () => {
    mount(
      createBridgeStub({
        listItems: () => Promise.resolve([item({ key: 'ORB-9', freshness: 'stale' })]),
        refresh: () =>
          Promise.resolve({
            ok: false as const,
            reason: 'unauthenticated' as const,
            message: 'The credential for this source was rejected. Set it again in Repositories.',
          }),
      }),
    );

    await screen.findByText('ORB-9');
    await userEvent.click(screen.getByRole('button', { name: /retry reconciling ORB-9/i }));

    expect(
      await screen.findByText(/the credential for this source was rejected/i),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /retry reconciling ORB-9/i })).toBeDefined();
  });

  it('filters and searches, and keeps that state in the URL', async () => {
    mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-1', title: 'Reconcile the ledger' }),
            item({
              key: 'ORB-9',
              title: 'Survey the orbit',
              repositoryId: 'repo-orbit',
              repositoryName: 'Orbit',
              packageId: 'pkg-orbit',
              sdlcName: 'Orbit lifecycle',
              stateId: 'surveying',
              stateName: 'Surveying',
              rawState: 'surveying',
            }),
          ]),
      }),
    );

    await screen.findByText('LED-1');

    await userEvent.selectOptions(screen.getByLabelText(/^repository$/i), 'repo-orbit');
    expect(screen.getAllByRole('listitem').length).toBe(1);
    expect(screen.getByText('ORB-9')).toBeDefined();
    // Principle XIII: the filter is in the URL, so the view is a link.
    expect(screen.getByTestId('query-string').textContent).toContain('repository=repo-orbit');

    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getAllByRole('listitem').length).toBe(2);
    expect(screen.getByTestId('query-string').textContent).toBe('');

    await userEvent.type(screen.getByLabelText(/^search$/i), 'survey');
    expect(screen.getAllByRole('listitem').length).toBe(1);
    expect(screen.getByText('ORB-9')).toBeDefined();
    expect(screen.getByTestId('query-string').textContent).toContain('q=survey');
  });

  it('restores the filter from the URL it was opened with', async () => {
    mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-1' }),
            item({ key: 'ORB-9', repositoryId: 'repo-orbit', repositoryName: 'Orbit' }),
          ]),
      }),
      '/?repository=repo-orbit',
    );

    await screen.findByText('ORB-9');
    expect(screen.getAllByRole('listitem').length).toBe(1);
  });

  it('says so deliberately when the filters match nothing', async () => {
    mount(
      createBridgeStub({ listItems: () => Promise.resolve([item({ key: 'LED-1' })]) }),
      '/?q=nothing-matches-this',
    );

    expect(await screen.findByText(/no items match these filters/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeDefined();
  });

  it('offers a retry when the list itself fails', async () => {
    let attempts = 0;
    mount(
      createBridgeStub({
        listItems: () => {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error('The Ledger source is unreachable.'));
          return Promise.resolve([item({ key: 'LED-1' })]);
        },
      }),
    );

    expect(await screen.findByText(/the item list could not be loaded/i)).toBeDefined();
    expect(screen.getByText(/the ledger source is unreachable/i)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: /reload the list/i }));
    expect(await screen.findByText('LED-1')).toBeDefined();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = mount(
      createBridgeStub({
        listItems: () =>
          Promise.resolve([
            item({ key: 'LED-3', attention: gateFailed }),
            item({ key: 'LED-5', attention: inputNeeded, freshness: 'stale' }),
            item({
              key: 'LED-7',
              stateId: UNMAPPED,
              stateName: null,
              rawState: 'Pending Countersign',
              disagreements: [
                {
                  field: 'stateId',
                  winner: 'ledger',
                  winningValue: 'drafting',
                  others: [{ provider: 'memo', value: 'clearing' }],
                },
              ],
            }),
          ]),
        listRepositories: () => Promise.resolve([repository('repo-ledger', 'Ledger')]),
      }),
    );

    await screen.findByText('LED-3');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no detectable accessibility violations in its empty state', async () => {
    const { container } = mount(
      createBridgeStub({
        listItems: () => Promise.resolve([]),
        listRepositories: () => Promise.resolve([]),
      }),
    );

    await screen.findByText(/no repositories registered yet/i);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
