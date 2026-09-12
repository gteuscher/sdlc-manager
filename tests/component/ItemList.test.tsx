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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { ReactElement } from 'react';

import type { ItemFilter } from '@core/ipc/schema';
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
    // 004. Active unless a case says otherwise, which is what every case here
    // assumed before the field existed.
    terminal: false,
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

/**
 * 004 — the second lifecycle's identity, so a two-repository list can be built
 * without repeating four fields at every call site. Its vocabulary is invented
 * like everything else here.
 */
const ORBIT = {
  repositoryId: 'repo-orbit',
  repositoryName: 'Orbit',
  packageId: 'pkg-orbit',
  sdlcName: 'Orbit lifecycle',
} as const;

/**
 * 004 — an item resting in a state its own lifecycle declares terminal.
 *
 * `terminal` is set on the fixture rather than derived from the state's name,
 * because that is exactly the rule the contract states: only the main process
 * holds the loaded definitions, so it decides, and the renderer is *told*
 * (contracts/finished-work.md §1). A fixture that inferred finishedness from a
 * name would be modelling a renderer this application must never have.
 *
 * Ledger's final state is `Countersigned`; Orbit's is `Splashdown`. Two
 * lifecycles finish work under two names, and neither name appears in
 * `src/renderer`.
 */
function finishedItem(
  overrides: Partial<WorkItemSummary> & { key: string },
): WorkItemSummary {
  return item({
    stateId: 'countersigned',
    stateName: 'Countersigned',
    rawState: 'countersigned',
    terminal: true,
    ...overrides,
  });
}

/**
 * 004 — `listItems` as the main process implements it: finished work is withheld
 * unless the caller asks for it, and asking is `includeTerminal`
 * (contracts/finished-work.md §2, `src/main/ipc/items.ts`).
 *
 * This matters more than a stub usually does. The renderer does **not** filter
 * terminal items itself — it cannot, because whether an item is finished is a
 * property of a definition only the main process holds — so a stub that returned
 * its whole seed regardless of the filter would let "finished work is absent by
 * default" pass while the list was in fact showing everything it was given.
 */
function serving(
  items: readonly WorkItemSummary[],
): (filter?: ItemFilter) => Promise<WorkItemSummary[]> {
  return (filter) =>
    Promise.resolve(
      filter?.includeTerminal === true
        ? [...items]
        : items.filter((entry) => !entry.terminal),
    );
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

/**
 * 004, FR-002 — the accessible name of the one control that tells an engineer
 * the list is withholding anything, asserted as an exact string.
 *
 * Exact, because the point of T010a is the *wording*: `getByRole` with a string
 * name matches the whole computed accessible name, so this constant is the name
 * rather than a description of it, and the claims asserted about it below are
 * claims about what is on screen.
 */
const FINISHED_CONTROL = 'Show finished work';

function finishedControl(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: FINISHED_CONTROL });
}

/**
 * The control as rendered, with generated ids normalised away so two separate
 * mounts can be compared. Ids are React's, not the design's; everything else —
 * the element, its type, its state, its wording, its wrapper — is.
 */
function finishedControlMarkup(): string {
  const rendered = finishedControl().closest('label');
  return (rendered?.outerHTML ?? '').replace(/\b(id|for)="[^"]*"/g, '$1="…"');
}

/**
 * Every distinct thing the screen says about finished, completed or hidden work.
 *
 * FR-002 forbids claiming that finished work *exists*, or how much of it there
 * is, while it is not being shown. That is a statement about the whole rendered
 * surface, not about one element, so the whole surface is what is read: any text
 * node that could be making such a claim comes back here to be accounted for.
 */
function claimsAboutFinishedWork(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const said: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (text !== '' && /finish|complet|withheld|hidden/i.test(text)) said.push(text);
  }
  return said;
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

  // ── Finished work (004) ────────────────────────────────────────────────────
  //
  // The list is bounded by the lifecycle that owns it, and finished work leaves
  // it. These cases are about the half that makes that disappearance
  // trustworthy: that an engineer is told the list is withholding something,
  // that one action brings it back, and that nothing about the telling claims
  // more than the application can prove.

  it('withholds finished work by default, includes it on request, and gives back exactly the list it started with', async () => {
    mount(
      createBridgeStub({
        listItems: serving([
          item({ key: 'LED-1' }),
          item({ key: 'LED-2', attention: inputNeeded }),
          finishedItem({ key: 'LED-9', title: 'Countersign the ledger' }),
          finishedItem({
            key: 'ORB-7',
            title: 'Splash down the orbiter',
            ...ORBIT,
            stateId: 'splashdown',
            stateName: 'Splashdown',
            rawState: 'splashdown',
          }),
        ]),
        listRepositories: () =>
          Promise.resolve([repository('repo-ledger', 'Ledger'), repository('repo-orbit', 'Orbit')]),
      }),
    );

    await screen.findByText('LED-1');

    // FR-001. Not sorted last, not dimmed — absent, in both lifecycles, and
    // with neither finished state's name anywhere on screen.
    const active = renderedKeys();
    expect(active.length).toBe(2);
    expect(active.join(' ')).not.toContain('LED-9');
    expect(active.join(' ')).not.toContain('ORB-7');
    expect(screen.queryByText('Countersigned')).toBeNull();
    expect(screen.queryByText('Splashdown')).toBeNull();

    // The whole rendered list, so "exactly what it was" can be asserted as the
    // literal thing rather than as a row count that two different lists share.
    const before = screen.getByRole('list').innerHTML;

    // One deliberate action, on a control that was there before it was needed.
    await userEvent.click(finishedControl());

    expect(await screen.findByText('LED-9')).toBeDefined();
    expect(list().getByText('ORB-7')).toBeDefined();
    expect(renderedKeys().length).toBe(4);
    // FR-007: the widened view is a link, like every other view state here.
    expect(screen.getByTestId('query-string').textContent).toContain('finished=1');

    await userEvent.click(finishedControl());

    expect(renderedKeys()).toEqual(active);
    expect(screen.getByRole('list').innerHTML).toBe(before);
    // And the ordinary view has an ordinary address again.
    expect(screen.getByTestId('query-string').textContent).toBe('');
  });

  it('says only that finished work can be shown — never that any exists, or how much', async () => {
    const { container } = mount(
      createBridgeStub({
        listItems: serving([item({ key: 'LED-1' }), finishedItem({ key: 'LED-9' })]),
        listRepositories: () => Promise.resolve([repository('repo-ledger', 'Ledger')]),
      }),
    );

    await screen.findByText('LED-1');

    // FR-002's positive half, asserted as the *name* rather than as the
    // presence of an element: a control is present whether or not it conveys
    // anything, and that shape is exactly how 003's W6 defect passed its test.
    // `getByRole` with a string matches the whole computed accessible name, so
    // what is asserted below is what an engineer — and a screen reader — reads.
    expect(finishedControl()).toBeDefined();
    expect(FINISHED_CONTROL).toMatch(/finished work/i);
    expect(FINISHED_CONTROL).toMatch(/^show\b/i);

    // Unchecked is what conveys "not currently shown". The wording offers; the
    // state reports.
    expect(finishedControl().checked).toBe(false);

    // Discoverable without prior knowledge of the feature: on screen from the
    // first render, not behind a disclosure that has to be found first.
    expect(finishedControl().closest('details')).toBeNull();
    expect(finishedControl().closest('[hidden]')).toBeNull();

    // FR-002's negative half, and the reason research.md §5 refused a count.
    // Read across the entire rendered surface: the only thing said anywhere
    // about finished work is the offer to show it.
    expect(claimsAboutFinishedWork(container)).toEqual([FINISHED_CONTROL]);
    expect(FINISHED_CONTROL).not.toMatch(/\d/);

    const whereFinishedWorkExists = finishedControlMarkup();

    // And now the repository that has none at all. A control that promised
    // finished work, or hinted at how much, would be lying here — so it must be
    // the same control, rendered the same way, saying the same thing. The
    // application cannot tell these two repositories apart without fetching the
    // very thing it is withholding, so neither may the interface.
    teardown?.();
    cleanup();

    const { container: withoutAny } = mount(
      createBridgeStub({
        listItems: serving([item({ key: 'LED-1' }), item({ key: 'LED-2' })]),
        listRepositories: () => Promise.resolve([repository('repo-ledger', 'Ledger')]),
      }),
    );

    await screen.findByText('LED-2');

    expect(finishedControlMarkup()).toBe(whereFinishedWorkExists);
    expect(claimsAboutFinishedWork(withoutAny)).toEqual([FINISHED_CONTROL]);
  });

  it('marks a finished row with a word, and names the state it finished in as its own lifecycle names it', async () => {
    mount(
      createBridgeStub({
        listItems: serving([
          item({ key: 'LED-1' }),
          finishedItem({ key: 'LED-9' }),
          finishedItem({
            key: 'ORB-7',
            ...ORBIT,
            stateId: 'splashdown',
            stateName: 'Splashdown',
            rawState: 'splashdown',
          }),
        ]),
      }),
      '/?finished=1',
    );

    await screen.findByText('LED-9');

    const rowFor = (key: string): HTMLElement => {
      const found = screen
        .getAllByRole('listitem')
        .find((row) => within(row).queryByText(key) !== null);
      if (found === undefined) throw new Error(`No row for ${key}`);
      return found;
    };

    // FR-003, Principle XI. The cue is a word, which is what survives
    // greyscale, a monochrome display, every form of colour blindness, and a
    // screen reader at once. The row is tinted as well, but the tint is the
    // addition — this is the mark.
    const mark = within(rowFor('LED-9')).getByText('Finished');
    expect(mark.textContent?.trim()).toBe('Finished');
    expect(rowFor('LED-9').textContent).toContain('Finished');
    expect(within(rowFor('LED-1')).queryByText('Finished')).toBeNull();

    // FR-003's second half, twice over: each finished item names the state it
    // finished in as *its own* lifecycle names it. Two lifecycles finish work
    // under two different words, and neither is known to this application.
    const stateFact = (key: string): string => {
      const label = within(rowFor(key)).getByText('State');
      return label.parentElement?.textContent ?? '';
    };
    expect(stateFact('LED-9')).toContain('Countersigned');
    expect(stateFact('ORB-7')).toContain('Splashdown');
    // Not the invented word "Finished" standing in for either of them.
    expect(stateFact('LED-9')).not.toBe(stateFact('ORB-7'));
  });

  it('narrows finished work with every filter that narrows active work, and can at last offer a terminal state as a choice', async () => {
    mount(
      createBridgeStub({
        listItems: serving([
          item({ key: 'LED-1', title: 'Reconcile the ledger' }),
          finishedItem({ key: 'LED-9', title: 'Countersign the ledger' }),
          item({
            key: 'ORB-4',
            title: 'Survey the orbit',
            ...ORBIT,
            stateId: 'surveying',
            stateName: 'Surveying',
            rawState: 'surveying',
          }),
          finishedItem({
            key: 'ORB-7',
            title: 'Splash down the orbiter',
            ...ORBIT,
            stateId: 'splashdown',
            stateName: 'Splashdown',
            rawState: 'splashdown',
          }),
        ]),
      }),
    );

    await screen.findByText('LED-1');

    const stateFilter = (): HTMLElement => screen.getByLabelText(/^state$/i);
    const repositoryFilter = (): HTMLElement => screen.getByLabelText(/^repository$/i);
    const sdlcFilter = (): HTMLElement => screen.getByLabelText(/^sdlc$/i);

    // The original defect, in one assertion. The list asked with no filter, so
    // finished items never arrived; the state options are built from the items
    // that did; so a terminal state could never be chosen, and the escape hatch
    // one layer down had no handle.
    expect(within(stateFilter()).queryByRole('option', { name: 'Splashdown' })).toBeNull();

    await userEvent.click(finishedControl());
    await screen.findByText('ORB-7');
    expect(renderedKeys().length).toBe(4);

    // And now it can be.
    expect(within(stateFilter()).getByRole('option', { name: 'Splashdown' })).toBeDefined();
    expect(within(stateFilter()).getByRole('option', { name: 'Countersigned' })).toBeDefined();

    // FR-006. Repository: one active and one finished item survive, which is the
    // point — finished work is not a second list beside this one.
    await userEvent.selectOptions(repositoryFilter(), 'repo-orbit');
    expect(renderedKeys().length).toBe(2);
    expect(list().getByText('ORB-4')).toBeDefined();
    expect(list().getByText('ORB-7')).toBeDefined();
    await userEvent.selectOptions(repositoryFilter(), '');

    // SDLC.
    await userEvent.selectOptions(sdlcFilter(), 'pkg-ledger');
    expect(renderedKeys().length).toBe(2);
    expect(list().getByText('LED-1')).toBeDefined();
    expect(list().getByText('LED-9')).toBeDefined();
    await userEvent.selectOptions(sdlcFilter(), '');

    // State — the terminal one, which is the choice this feature made reachable.
    await userEvent.selectOptions(stateFilter(), 'splashdown');
    expect(renderedKeys().length).toBe(1);
    expect(list().getByText('ORB-7')).toBeDefined();
    await userEvent.selectOptions(stateFilter(), '');

    // Search, over a finished item's title.
    await userEvent.type(screen.getByLabelText(/^search$/i), 'countersign the');
    expect(renderedKeys().length).toBe(1);
    expect(list().getByText('LED-9')).toBeDefined();

    // Throughout: finished work stayed included, and the address still says so.
    expect(finishedControl().checked).toBe(true);
    expect(screen.getByTestId('query-string').textContent).toContain('finished=1');
  });

  it('tells an engineer whose work has all finished that nothing is in flight, rather than that nothing is here', async () => {
    mount(
      createBridgeStub({
        listItems: serving([
          finishedItem({ key: 'LED-9' }),
          finishedItem({ key: 'LED-10' }),
        ]),
        listRepositories: () => Promise.resolve([repository('repo-ledger', 'Ledger')]),
      }),
    );

    // Not the first-run state: repositories are registered, and they answered.
    expect(await screen.findByText(/no active work items/i)).toBeDefined();
    expect(screen.queryByText(/no repositories registered yet/i)).toBeNull();
    expect(screen.getByText(/nothing in flight/i)).toBeDefined();

    // It points at the finished work rather than leaving the engineer to
    // conclude their repository is broken — and still without claiming any
    // exists, or how much (FR-002).
    const hint = screen.getByText(/lifecycle considers finished is not listed here/i);
    expect(hint.textContent).toMatch(/show finished work/i);
    expect(hint.textContent).not.toMatch(/\d/);

    // Pointing only means something if the thing pointed at is on screen. This
    // is the one view where the list itself offers no other route to it: every
    // row that could have carried the engineer to the control is gone.
    expect(finishedControl()).toBeDefined();

    await userEvent.click(finishedControl());

    expect(await screen.findByText('LED-9')).toBeDefined();
    expect(renderedKeys().length).toBe(2);
  });

  it('has no detectable accessibility violations with finished work included, or with the control in either state', async () => {
    const { container } = mount(
      createBridgeStub({
        listItems: serving([
          item({ key: 'LED-1' }),
          item({ key: 'LED-3', attention: gateFailed }),
          finishedItem({ key: 'LED-9' }),
          finishedItem({
            key: 'ORB-7',
            ...ORBIT,
            stateId: 'splashdown',
            stateName: 'Splashdown',
            rawState: 'splashdown',
          }),
        ]),
        listRepositories: () =>
          Promise.resolve([repository('repo-ledger', 'Ledger'), repository('repo-orbit', 'Orbit')]),
      }),
      '/?finished=1',
    );

    await screen.findByText('LED-9');
    expect(finishedControl().checked).toBe(true);

    expect(await axe(container)).toHaveNoViolations();

    // The control's other state is a different rendering — a different list, a
    // different set of filter options — so it is a different thing to check.
    await userEvent.click(finishedControl());
    await waitFor(() => {
      expect(screen.queryByText('LED-9')).toBeNull();
    });
    expect(finishedControl().checked).toBe(false);

    expect(await axe(container)).toHaveNoViolations();
  });
});
