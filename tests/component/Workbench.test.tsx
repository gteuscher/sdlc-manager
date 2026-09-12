/**
 * T007–T012, T021–T024, T030–T032, T035, T037, T039 — the workbench as an
 * *arrangement*, which is the only thing this file is about.
 *
 * **004 added a fifth key to the list's query string**, and its T013 and T034–T036
 * live at the bottom of this file for the same reason 003's did: including
 * finished work is a question about the list, and every claim worth making about
 * it is a claim about what the *other* pane does while it is asked. (Both features
 * number a task T035; the 004 block says which is which at each test.)
 *
 * Each pane already has its own suite: `ItemList.test.tsx` proves what the list
 * shows and `StateTabs.test.tsx` proves what the detail shows, and neither of
 * them changed when the two became panes of one view. What no pane's suite can
 * be asked is the question this feature exists to answer — whether both are on
 * screen *at once*, whether touching one disturbs the other, and what the
 * arrangement does when the window shrinks, a pane throws, or the thing being
 * read turns out not to exist any more. So everything below mounts the real
 * route hierarchy — the layout route, its index child, and its `items/:key`
 * child — and asserts through rendered output and user interaction only
 * (Principle IV). Nothing reaches into a component's internals and no module
 * belonging to the renderer is mocked; the single seam is `window.dashboard`,
 * the renderer's entire privilege set (ipc-surface.md §4), so a pane that needed
 * anything else would fail to render here rather than quietly work.
 *
 * **The lifecycle below is invented, and that is deliberate.** A workbench tested
 * against vocabulary that appears in the specs would prove nothing about SC-003's
 * claim that an unfamiliar SDLC renders correctly, and FR-023 says the layout
 * must not gain knowledge of a single state, gate or provider name. Two
 * repositories on two different lifecycles share one pane here, and no state,
 * repository or lifecycle name in this file appears anywhere in `src/renderer` —
 * nor does it overlap the vocabulary the other two component suites invented, so
 * the three files stay independent proofs rather than one proof written thrice.
 *
 * **What jsdom can and cannot check.** There is no layout engine here: no element
 * has a width, and every `scrollTop` reads zero whatever it is set to. So two of
 * these requirements are asserted for the half a machine can see, and the other
 * half is named rather than faked — T008 checks that the list is not *remounted*
 * instead of pretending to measure a scroll offset, and T035 checks that the
 * absent pane is genuinely absent instead of pretending to measure a column
 * width. Both are written out at the assertion, in the same spirit as
 * `tests/smoke/scale.spec.ts` recording which half of SC-008 a test can own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { ReactElement } from 'react';

import type { ItemFilter } from '@core/ipc/schema';
import type {
  AttentionSignal,
  StateView,
  WorkItemDetail,
  WorkItemSummary,
} from '@core/model/observed';

import { NoSelection } from '@renderer/components/NoSelection';
import ItemDetail from '@renderer/routes/ItemDetail';
import { Workbench } from '@renderer/routes/Workbench';
import { createBridgeStub, installBridge, type BridgeStub } from '../support/bridge';

// ── Two invented lifecycles ─────────────────────────────────────────────────

const RECONCILED = '2026-09-12T09:15:00.000Z';

/** Nothing but this file knows either of these. Both arrive in the same pane. */
const FOUNDRY_STATES: readonly { id: string; name: string }[] = [
  { id: 'smelting', name: 'Smelting' },
  { id: 'tempering', name: 'Tempering' },
  { id: 'stamping', name: 'Stamping' },
];

const HARBOUR_STATES: readonly { id: string; name: string }[] = [
  { id: 'berthing', name: 'Berthing' },
  { id: 'lading', name: 'Lading' },
];

function foundryItem(overrides: Partial<WorkItemSummary> & { key: string }): WorkItemSummary {
  return {
    title: `Work on ${overrides.key}`,
    repositoryId: 'repo-foundry',
    repositoryName: 'Foundry',
    packageId: 'pkg-foundry',
    sdlcName: 'Foundry lifecycle',
    unit: 'billet',
    stateId: 'tempering',
    stateName: 'Tempering',
    rawState: 'tempering',
    attention: null,
    reconciledAt: RECONCILED,
    freshness: 'fresh',
    disagreements: [],
    // 004. Active unless a case says otherwise.
    terminal: false,
    ...overrides,
  };
}

function harbourItem(overrides: Partial<WorkItemSummary> & { key: string }): WorkItemSummary {
  return {
    ...foundryItem(overrides),
    repositoryId: 'repo-harbour',
    repositoryName: 'Harbour',
    packageId: 'pkg-harbour',
    sdlcName: 'Harbour lifecycle',
    unit: 'consignment',
    stateId: 'berthing',
    stateName: 'Berthing',
    rawState: 'berthing',
    ...overrides,
  };
}

const awaitingInput: AttentionSignal = {
  kind: 'input_needed',
  reason: 'The crucible log needs a reading before this goes further.',
  stateId: 'smelting',
};

const gateFailed: AttentionSignal = {
  kind: 'gate_failed',
  reason: 'The draught check did not pass. Re-run it where it is configured.',
  stateId: 'berthing',
};

/** The four items every test below shares unless it says otherwise. */
function fleet(): WorkItemSummary[] {
  return [
    foundryItem({ key: 'FDY-1', title: 'Smelt the crucible batch', stateId: 'smelting', stateName: 'Smelting', rawState: 'smelting', attention: awaitingInput }),
    foundryItem({ key: 'FDY-2', title: 'Temper the flywheel casting' }),
    foundryItem({ key: 'FDY-3', title: 'Stamp the maker’s mark', stateId: 'stamping', stateName: 'Stamping', rawState: 'stamping' }),
    harbourItem({ key: 'HRB-7', title: 'Berth the tender at quay nine', attention: gateFailed }),
  ];
}

function state(declared: { id: string; name: string }, ordinal: number, progress: StateView['progress'], terminal: boolean): StateView {
  return {
    id: declared.id,
    name: declared.name,
    description: null,
    ordinal,
    progress,
    awaitsHuman: false,
    terminal,
    gates: [],
    artifacts: [],
  };
}

/** The detail the main process would resolve for a summary, against its own repository's definition. */
function detailFor(summary: WorkItemSummary): WorkItemDetail {
  const declared = summary.repositoryId === 'repo-harbour' ? HARBOUR_STATES : FOUNDRY_STATES;
  const at = declared.findIndex((candidate) => candidate.id === summary.stateId);
  return {
    item: summary,
    states: declared.map((candidate, index) =>
      state(candidate, index, index < at ? 'completed' : index === at ? 'current' : 'not_reached', index === declared.length - 1),
    ),
    currentStateId: summary.stateId,
  };
}

/**
 * The same fleet with one finished item in each lifecycle — each resting in the
 * state its *own* definition declares terminal (`detailFor` makes the last
 * declared state terminal, so Stamping and Lading are the two).
 *
 * `FDY-3` is dropped for these cases rather than reused. It sits in Stamping
 * carrying `terminal: false`, which is a contradiction the four-item fleet gets
 * away with only because nothing there reads the flag; a list that both hides and
 * marks finished work reads it, and an active item resting in a terminal state
 * would be asserting something no repository can report.
 */
function fleetWithFinished(): WorkItemSummary[] {
  return [
    ...fleet().filter((item) => item.key !== 'FDY-3'),
    foundryItem({
      key: 'FDY-8',
      title: 'Crate the finished billet',
      stateId: 'stamping',
      stateName: 'Stamping',
      rawState: 'stamping',
      terminal: true,
    }),
    harbourItem({
      key: 'HRB-9',
      title: 'Sign off the discharged consignment',
      stateId: 'lading',
      stateName: 'Lading',
      rawState: 'lading',
      terminal: true,
    }),
  ];
}

/** A bridge serving the whole fleet, and whichever of it is asked for by key. */
function fleetBridge(items: WorkItemSummary[] = fleet()): BridgeStub {
  // Declared before the overrides so they can record their own calls. The base
  // stub tracks the methods it implements, but an override replaces the tracking
  // along with the answer — and both of the methods this file cares about are
  // overridden, so a count taken without this line is a count of nothing. The
  // assertions below that read it check that it is non-zero before relying on it.
  const stub: BridgeStub = createBridgeStub({
    // 004. The main process withholds finished work unless it is asked for, and
    // every claim below about `?finished=1` depends on the thing being talked to
    // behaving that way — a stub that served finished work regardless would pass
    // whether or not the flag ever reached the bridge. The main process's other
    // escape, that naming a `stateId` returns terminal items resting in it, is
    // deliberately not reproduced: this list filters by state locally and never
    // sends one, so honouring it here would be answering a question nothing asks.
    listItems: (filter?: ItemFilter) => {
      stub.calls.push('listItems');
      return Promise.resolve(
        items.filter((item) => filter?.includeTerminal === true || !item.terminal),
      );
    },
    getItem: (key: string) => {
      stub.calls.push('getItem');
      const found = items.find((candidate) => candidate.key === key);
      if (found === undefined) {
        return Promise.resolve({
          ok: false as const,
          reason: 'not_found' as const,
          message: `${key} is not reported by any registered repository.`,
        });
      }
      return Promise.resolve({ ok: true as const, value: detailFor(found) });
    },
  });
  return stub;
}

// ── Harness ─────────────────────────────────────────────────────────────────

let teardown: (() => void) | undefined;
let originalMatchMedia: typeof window.matchMedia | undefined;

/**
 * The real route hierarchy from `App.tsx`: a layout route rendering the
 * workbench, an index child for the no-selection pane, and `items/:key` for the
 * detail. The nesting *is* the feature (FR-001, FR-004), so a test that mounted
 * `Workbench` with a hand-made outlet would assert nothing about it.
 *
 * `ItemDetail` is imported directly rather than lazily. The lazy boundary is a
 * bundling concern that `.size-limit.json` gates; importing it eagerly here keeps
 * every assertion below about the arrangement instead of about chunk loading.
 * `detail` overrides that child for the one test that needs a pane which throws.
 */
function mount(stub: BridgeStub, entry = '/', detail: ReactElement = <ItemDetail />): { container: HTMLElement } {
  teardown = installBridge(stub);
  // A test-local client: the production client retries twice with a backoff,
  // which would turn a failure assertion into a several-second wait.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/" element={<Workbench />}>
            <Route index element={<NoSelection />} />
            <Route path="items/:key" element={detail} />
          </Route>
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { container };
}

/** Tears the whole application down and starts it again, as closing the window would. */
function remount(stub: BridgeStub, entry = '/'): { container: HTMLElement } {
  cleanup();
  teardown?.();
  return mount(stub, entry);
}

/** Renders the current URL, so navigation is asserted as output rather than as internals. */
function LocationProbe(): ReactElement {
  const location = useLocation();
  return <p data-testid="url">{`${location.pathname}${location.search}`}</p>;
}

function url(): string {
  return screen.getByTestId('url').textContent ?? '';
}

/**
 * The two panes, addressed the way the contract names them
 * (contracts/workbench-layout.md §2) rather than by class. Both queries would
 * fail if the landmark or its accessible name changed, which is the point.
 */
function listPane(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Work items' });
}

function detailPane(): HTMLElement {
  return screen.getByRole('main', { name: 'Item detail' });
}

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: /^(hide|show) the work item list$/i });
}

/** The region the toggle claims to control, found through `aria-controls` rather than by class. */
function controlledRegion(): HTMLElement {
  const id = toggle().getAttribute('aria-controls');
  const region = id === null ? null : document.getElementById(id);
  if (region === null) throw new Error('the pane toggle controls nothing');
  return region;
}

function rowKeys(): string[] {
  return within(listPane())
    .getAllByRole('listitem')
    .map((row) => within(row).getByRole('link').textContent ?? '');
}

/**
 * 004's control, addressed by what it says rather than by class.
 *
 * Re-queried on every call rather than captured once: including finished work
 * changes which list is being asked for, so the filter bar is unmounted for as
 * long as the new answer is pending and a held reference would be a detached node
 * by the time the rows come back.
 */
function finishedToggle(): HTMLInputElement {
  return within(listPane()).getByRole('checkbox', {
    name: /^show finished work$/i,
  }) as HTMLInputElement;
}

async function open(key: string): Promise<void> {
  await userEvent.click(within(listPane()).getByRole('link', { name: new RegExp(key) }));
}

/**
 * Below the threshold at which two panes stop being two panes. jsdom implements
 * no media queries, so the window width is the one thing here that has to be
 * stated rather than observed.
 */
function stubWindowWidth(narrow: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: narrow,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

beforeEach(() => {
  teardown = undefined;
  originalMatchMedia = window.matchMedia;
  // The collapse preference outlives a test the way it outlives a restart, which
  // is the whole of FR-011 and would otherwise leak between the cases below.
  try {
    window.localStorage.clear();
  } catch {
    // A storage-less environment is one `usePaneState` already resolves to expanded.
  }
});

afterEach(() => {
  teardown?.();
  vi.useRealTimers();
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window, 'matchMedia');
  } else {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  }
});

// ── User Story 1: both at once ──────────────────────────────────────────────

describe('the two-pane workbench', () => {
  it('shows the list and the open item at the same time, without dimming what else is waiting', async () => {
    mount(fleetBridge(), '/items/FDY-2');

    // FR-001, SC-001: one view, both panes, neither standing in for the other.
    expect(await within(listPane()).findByText('FDY-2')).toBeDefined();
    expect(within(detailPane()).getByText('Temper the flywheel casting')).toBeDefined();
    expect(rowKeys().length).toBe(4);

    // And the reason simultaneity is worth having: the two items that need the
    // engineer are still marked while a third one is being read. A workbench
    // that quieted the list while the detail was open would have re-created the
    // page it replaced.
    const list = within(listPane());
    expect(list.getByText('Awaiting your input')).toBeDefined();
    expect(list.getByText('Gate failed')).toBeDefined();
    expect(list.getByText(awaitingInput.reason)).toBeDefined();
    expect(list.getByText(gateFailed.reason)).toBeDefined();
  });

  it('changes only the detail when a second item is selected, leaving the list in place', async () => {
    mount(fleetBridge(), '/items/FDY-1');

    await within(listPane()).findByText('FDY-1');

    // The identity of the nodes, captured before the second selection.
    const listElement = within(listPane()).getByRole('list');
    const untouchedRow = within(listPane()).getAllByRole('listitem')[3];
    const scrollContainer = controlledRegion();

    await open('HRB-7');

    expect(within(detailPane()).getByText('Berth the tender at quay nine')).toBeDefined();
    expect(url()).toBe('/items/HRB-7');

    // FR-004: "without replacing, reloading, or repositioning the list". jsdom
    // runs no layout, so a scroll offset genuinely cannot be measured here —
    // every `scrollTop` in this environment reads zero whatever it is set to,
    // and an assertion about one would be theatre. What *is* observable is the
    // condition that makes losing the offset possible in the first place: a
    // remount. These are the same DOM objects, not equal ones, so the browser
    // never had an opportunity to reset a scroll position, re-run the query, or
    // re-order the rows. The offset itself is covered where a real layout
    // exists, by the quickstart walkthrough.
    expect(within(listPane()).getByRole('list')).toBe(listElement);
    expect(within(listPane()).getAllByRole('listitem')[3]).toBe(untouchedRow);
    expect(controlledRegion()).toBe(scrollContainer);
    expect(rowKeys().length).toBe(4);
  });

  it('marks the row being read in a way that survives greyscale', async () => {
    mount(fleetBridge(), '/items/FDY-3');

    await within(listPane()).findByText('FDY-3');

    // FR-005: exactly one row is current, and it is the one in the detail.
    const current = within(listPane())
      .getAllByRole('listitem')
      .filter((row) => row.getAttribute('aria-current') === 'true');
    expect(current.length).toBe(1);
    const row = current[0] as HTMLElement;
    expect(within(row).getByRole('link').textContent).toContain('FDY-3');

    // Principle XI: the row is also tinted, but a word is what a screen reader
    // announces and what survives a monochrome display. Only the current row
    // carries it, so the cue distinguishes rather than merely decorating.
    expect(within(row).getByText('Reading')).toBeDefined();
    expect(within(listPane()).getAllByText('Reading').length).toBe(1);
  });

  it('fills the detail pane with copy rather than a blank column when nothing is selected', async () => {
    mount(fleetBridge());

    await within(listPane()).findByText('FDY-1');

    // FR-006, Principle X. This is the most-seen empty state in the product —
    // half the workbench, every time the application opens.
    const detail = within(detailPane());
    expect(detail.getByRole('heading', { name: /choose a work item to read it here/i })).toBeDefined();
    expect(detail.getByText(/the list stays where it is/i)).toBeDefined();
    // It says what selecting will do, and it is not a spinner waiting on
    // something: nothing has been read for this pane, so there is nothing for it
    // to be pending on and nothing to announce.
    expect(detail.queryAllByRole('status').length).toBe(0);
    expect(detail.queryByRole('progressbar')).toBeNull();
  });

  it('names both regions, and has no detectable accessibility violations assembled', async () => {
    const { container } = mount(fleetBridge());

    await within(listPane()).findByText('FDY-1');

    // contracts/workbench-layout.md §2. Two unnamed regions tell a screen-reader
    // user nothing about which is which, and a document has one `main`.
    expect(screen.getAllByRole('main').length).toBe(1);
    expect(screen.getAllByRole('complementary').length).toBe(1);
    expect(detailPane().getAttribute('aria-label')).toBe('Item detail');
    expect(listPane().getAttribute('aria-label')).toBe('Work items');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('keeps the list usable when the detail pane throws while rendering', async () => {
    // The only way to provoke a *thrown render* without mocking a renderer
    // module is to hand the route a child that throws — which is the same seam
    // React gives the real detail. It throws for one item and renders for
    // another, because FR-019's promise is not merely that the list survives:
    // it is that the engineer can move to something else instead of reloading.
    function ThrowingDetail(): ReactElement {
      const { key } = useParams();
      if (key === 'FDY-1') throw new Error('The detail pane failed while rendering.');
      return <p>Opened {key}</p>;
    }

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mount(fleetBridge(), '/items/FDY-1', <ThrowingDetail />);

      await within(listPane()).findByText('FDY-1');

      // The failure is reported in place, inside the pane that failed.
      expect(within(detailPane()).getByText(/this view could not be displayed/i)).toBeDefined();

      // And the other pane is untouched — every row still listed, still marked,
      // still selectable. A shared boundary would have blanked all of this.
      expect(rowKeys().length).toBe(4);
      expect(within(listPane()).getByText('Gate failed')).toBeDefined();

      await open('HRB-7');

      expect(url()).toBe('/items/HRB-7');
      expect(within(detailPane()).getByText('Opened HRB-7')).toBeDefined();
      expect(within(detailPane()).queryByText(/this view could not be displayed/i)).toBeNull();
    } finally {
      logged.mockRestore();
    }
  });

  // ── User Story 2: collapsing ──────────────────────────────────────────────

  it('collapses and expands the list, saying which it will do next', async () => {
    const { container } = mount(fleetBridge());

    await within(listPane()).findByText('FDY-1');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(toggle());

    // FR-008. The rows leave the accessibility tree and the tab order...
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(controlledRegion().hasAttribute('hidden')).toBe(true);
    expect(within(listPane()).queryAllByRole('listitem').length).toBe(0);
    // ...but the list is hidden, not unmounted, which is what lets FR-010 return
    // it with everything it had.
    expect(container.querySelectorAll('.items__list').length).toBe(1);
    // The label names the next action, so a screen-reader user is never told
    // "hide" by a control that shows.
    expect(screen.getByRole('button', { name: 'Show the work item list' })).toBeDefined();

    await userEvent.click(toggle());

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(controlledRegion().hasAttribute('hidden')).toBe(false);
    expect(rowKeys().length).toBe(4);
  });

  it('still reports how many items need attention while collapsed, whatever the filters hide', async () => {
    mount(fleetBridge());

    await within(listPane()).findByText('FDY-1');

    // A filter that hides one of the two items needing attention. The engineer
    // can see the filter controls while they are on screen, so the list's own
    // count describing the filtered view is right there.
    await userEvent.selectOptions(within(listPane()).getByLabelText(/^repository$/i), 'repo-foundry');
    expect(rowKeys().length).toBe(3);

    await userEvent.click(toggle());

    // FR-009. Collapsed, the filter controls are gone with the rest of the list,
    // and a rail reporting "one" — or worse, "nothing needs you" — would be
    // telling the engineer to stop looking at something still waiting on them.
    // So the collapsed count is the unfiltered total, and it is announced rather
    // than merely drawn.
    const announced = screen.getAllByRole('status');
    expect(announced.length).toBe(1);
    expect(announced[0]?.textContent).toContain('2');
    expect(announced[0]?.textContent).toContain('items need your attention');
  });

  it('returns the list exactly as it was, and remembers the collapse across a restart', async () => {
    const stub = fleetBridge();
    mount(stub, '/items/FDY-3');

    await within(listPane()).findByText('FDY-3');
    const reads = () => stub.calls.filter((call) => call === 'getItem').length;
    const before = reads();

    await userEvent.click(toggle());

    // FR-010: what was open stays open. Collapsing is a fact about the
    // furniture, so the detail is not disturbed by it at all.
    expect(within(detailPane()).getByText('Stamp the maker’s mark')).toBeDefined();

    await userEvent.click(toggle());

    const current = within(listPane())
      .getAllByRole('listitem')
      .filter((row) => row.getAttribute('aria-current') === 'true');
    expect(current.length).toBe(1);
    expect(within(current[0] as HTMLElement).getByRole('link').textContent).toContain('FDY-3');
    // Nothing was re-read to restore it, because nothing was ever unmounted.
    expect(reads()).toBe(before);

    // FR-011: the preference is written where a restart can find it. The literal
    // key is asserted rather than imported, because what survives a restart is
    // the string on disk — a rename is a migration, not a refactor.
    expect(window.localStorage.getItem('sdlc.workbench.listCollapsed')).toBe('false');

    await userEvent.click(toggle());
    expect(window.localStorage.getItem('sdlc.workbench.listCollapsed')).toBe('true');

    // And a fresh application, started against that stored preference, opens
    // collapsed without being told again.
    remount(fleetBridge(), '/items/FDY-3');

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(controlledRegion().hasAttribute('hidden')).toBe(true);
  });

  it('keeps the collapse control reachable and operable by keyboard in both states', async () => {
    mount(fleetBridge());

    await within(listPane()).findByText('FDY-1');

    // FR-012, first half: reachable. The control is the first stop in the view,
    // ahead of the region it governs.
    await userEvent.tab();
    expect(document.activeElement).toBe(toggle());

    await userEvent.keyboard('{Enter}');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    // FR-012, second half, and the trap it exists to forbid: a pane collapsed to
    // nothing must not take its own expand control with it. The control is
    // outside the region it hides, so it is still the first stop and still
    // operable — reached from a standing start, not from the focus the previous
    // press happened to leave behind.
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.tab();
    expect(document.activeElement).toBe(toggle());

    await userEvent.keyboard('{ }');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(rowKeys().length).toBe(4);
  });

  // ── User Story 3: narrowing the list ──────────────────────────────────────

  it('narrows the list without touching what the detail is showing', async () => {
    const stub = fleetBridge();
    mount(stub, '/items/FDY-2');

    await within(listPane()).findByText('FDY-2');
    const reads = stub.calls.filter((call) => call === 'getItem').length;

    await userEvent.selectOptions(within(listPane()).getByLabelText(/^repository$/i), 'repo-foundry');

    // FR-014. The list changed...
    expect(rowKeys().length).toBe(3);
    expect(within(listPane()).queryByText('HRB-7')).toBeNull();
    // ...and the detail did not, down to not having been asked again. Filtering
    // is a question about the list; the open item is not part of the question.
    expect(within(detailPane()).getByText('Temper the flywheel casting')).toBeDefined();
    expect(url()).toBe('/items/FDY-2?repository=repo-foundry');
    expect(stub.calls.filter((call) => call === 'getItem').length).toBe(reads);
  });

  it('keeps an excluded selection open, and says the list is no longer showing it', async () => {
    mount(fleetBridge(), '/items/HRB-7');

    await within(listPane()).findByText('HRB-7');

    await userEvent.selectOptions(within(listPane()).getByLabelText(/^repository$/i), 'repo-foundry');

    // FR-015. The row goes, because the engineer asked for a narrower list and
    // the list must answer the question it was asked...
    expect(within(listPane()).queryByText('HRB-7')).toBeNull();
    // ...but what is being read is not closed by a filter, and the pane still
    // shows it.
    expect(within(detailPane()).getByText('Berth the tender at quay nine')).toBeDefined();

    // And the disappearance is explained where it happened, rather than leaving
    // the engineer hunting a row that looks deleted. `role="status"`, because
    // the row vanishes the instant the filter changes.
    const notice = within(listPane()).getByText(/not among those shown/i);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('clearing the filters will bring it back');

    await userEvent.click(within(listPane()).getByRole('button', { name: /clear filters/i }));
    expect(rowKeys().length).toBe(4);
    expect(within(listPane()).queryByText(/not among those shown/i)).toBeNull();
  });

  it('restores filter, search and selection together from one URL', async () => {
    mount(fleetBridge(), '/items/HRB-7?repository=repo-harbour&q=quay');

    await within(listPane()).findByText('HRB-7');

    // FR-016, Principle XIII: the whole arrangement is a link, so a colleague
    // can be sent one and land on what was being looked at. All three parts come
    // back, and none of them is remembered anywhere but the URL.
    const filters = within(listPane());
    expect((filters.getByLabelText(/^repository$/i) as HTMLSelectElement).value).toBe('repo-harbour');
    expect((filters.getByLabelText(/^search$/i) as HTMLInputElement).value).toBe('quay');
    expect(rowKeys()).toEqual(['HRB-7Berth the tender at quay nine']);
    expect(within(detailPane()).getByText('Berth the tender at quay nine')).toBeDefined();
  });

  /**
   * Quickstart W6, and the case that caught a real defect during validation.
   *
   * The list's filter and the detail's tab now share one query string. Renaming
   * the detail's parameter from `?state=` to `?tab=` (research.md §2) stopped the
   * tab from filtering the list — but the two directions fail through different
   * code, and only one of them had been fixed. The list wrote its filters by
   * building a fresh query string and replacing the whole thing, which was
   * correct while it owned its URL as a page and silently deleted `?tab=` the
   * moment it became a pane: the open item jumped back to the state it occupies
   * on every filter change and on **every keystroke in the search box**.
   *
   * So both directions are asserted here, and all three of the list's write paths
   * are exercised — the select, the search field, and the clear button — because
   * that is how the defect hid: the select was the obvious one to check, and the
   * keystroke path is the one an engineer would actually hit first.
   */
  it('lets the filter and the open item’s tab share one URL without either erasing the other', async () => {
    mount(fleetBridge(), '/items/FDY-2?repository=repo-foundry&tab=stamping');

    await within(listPane()).findByText('FDY-2');
    const repository = () => within(listPane()).getByLabelText(/^repository$/i) as HTMLSelectElement;
    const openTab = () =>
      within(detailPane())
        .getAllByRole('tab')
        .find((tab) => tab.getAttribute('aria-selected') === 'true');

    expect(openTab()?.textContent).toContain('Stamping');

    // Changing the tab leaves the filter alone.
    await userEvent.click(within(detailPane()).getByRole('tab', { name: /Smelting/ }));
    expect(url()).toContain('repository=repo-foundry');
    expect(repository().value).toBe('repo-foundry');

    // Narrowing by state leaves the tab alone — the two words no longer collide.
    await userEvent.selectOptions(within(listPane()).getByLabelText(/^state$/i), 'tempering');
    expect(url()).toContain('tab=smelting');
    expect(url()).toContain('state=tempering');
    expect(openTab()?.textContent).toContain('Smelting');

    // A single keystroke in the search box, which writes the query string on
    // every character, must not cost the tab either.
    await userEvent.type(within(listPane()).getByLabelText(/^search$/i), 'Temper');
    expect(url()).toContain('tab=smelting');
    expect(openTab()?.textContent).toContain('Smelting');

    // And clearing the filters clears the filters, not the arrangement.
    await userEvent.click(within(listPane()).getByRole('button', { name: /clear filters/i }));
    expect(url()).toBe('/items/FDY-2?tab=smelting');
    expect(openTab()?.textContent).toContain('Smelting');
  });

  // ── 004: bounding the active list ─────────────────────────────────────────

  /**
   * 004's T013 — FR-005 and SC-008.
   *
   * 003's FR-014 rule ("filtering is a question about the list; the open item is
   * not part of the question") applied to a control that did not exist when it
   * was written. Including finished work changes which list is fetched, and the
   * obvious way to implement that — invalidate the items and let everything
   * downstream settle — takes the detail with it. So the detail is asserted twice
   * over: it still shows the same item, and it was never asked again.
   */
  it('leaves the detail showing the same item while finished work is included and excluded', async () => {
    const stub = fleetBridge(fleetWithFinished());
    mount(stub, '/items/FDY-2');

    await within(listPane()).findByText('FDY-2');
    const reads = () => stub.calls.filter((call) => call === 'getItem').length;
    const before = reads();
    // The counter is load-bearing for the last assertion in each half, so it is
    // checked for being a counter at all: a stub that recorded nothing would make
    // "not re-fetched" true of every implementation, including a wrong one.
    expect(before).toBeGreaterThan(0);

    // Excluded by default, and the detail pane is showing an active item.
    expect(within(listPane()).queryByText('FDY-8')).toBeNull();
    expect(within(detailPane()).getByText('Temper the flywheel casting')).toBeDefined();

    await userEvent.click(finishedToggle());

    // The list widened...
    expect(await within(listPane()).findByText('FDY-8')).toBeDefined();
    expect(within(listPane()).getByText('HRB-9')).toBeDefined();
    expect(url()).toBe('/items/FDY-2?finished=1');
    // ...and the detail is on the same item, unread a second time.
    expect(within(detailPane()).getByText('Temper the flywheel casting')).toBeDefined();
    expect(reads()).toBe(before);

    await userEvent.click(finishedToggle());

    // And back again, which is the half that a refetch-on-change would break
    // just as thoroughly: the flag leaves the address entirely rather than
    // becoming `finished=0`, so the ordinary view has an ordinary URL.
    await within(listPane()).findByText('FDY-2');
    expect(within(listPane()).queryByText('FDY-8')).toBeNull();
    expect(url()).toBe('/items/FDY-2');
    expect(within(detailPane()).getByText('Temper the flywheel casting')).toBeDefined();
    expect(reads()).toBe(before);
  });

  /**
   * 004's T034 — FR-007, and Story 3's whole point: a fifth piece of view state
   * that did not travel in the address would be the exception that starts eroding
   * the rule 003 established.
   */
  it('restores the finished flag, a filter, a search and a selection together from one URL', async () => {
    mount(fleetBridge(fleetWithFinished()), '/items/HRB-9?finished=1&repository=repo-harbour&q=discharged');

    await within(listPane()).findByText('HRB-9');

    const filters = within(listPane());
    expect(finishedToggle().checked).toBe(true);
    expect((filters.getByLabelText(/^repository$/i) as HTMLSelectElement).value).toBe('repo-harbour');
    expect((filters.getByLabelText(/^search$/i) as HTMLInputElement).value).toBe('discharged');

    // All four at once: the flag admitted a finished item that the default view
    // withholds, the repository filter and the search narrowed it to one, and the
    // selection opened it. Any one of the four missing changes this list.
    expect(rowKeys()).toEqual(['HRB-9Sign off the discharged consignment']);
    expect(within(detailPane()).getByText('Sign off the discharged consignment')).toBeDefined();
    // And the row that came back is the finished one, marked as such — the flag
    // was honoured rather than the search happening to find something active.
    expect(within(listPane()).getByText('Finished')).toBeDefined();
  });

  /**
   * 004's T035 — Story 3, scenario 2. Not 003's T035, which is the narrow-window
   * case further down.
   */
  it('excludes finished work from an address that does not mention it', async () => {
    mount(fleetBridge(fleetWithFinished()), '/items/FDY-2');

    await within(listPane()).findByText('FDY-2');

    // The quieter default, for someone who has never heard of this feature: the
    // address says nothing, so the list is the bounded one.
    expect(rowKeys().map((row) => row.slice(0, 5))).toEqual(['FDY-1', 'HRB-7', 'FDY-2']);
    expect(within(listPane()).queryByText('FDY-8')).toBeNull();
    expect(within(listPane()).queryByText('HRB-9')).toBeNull();
    expect(within(listPane()).queryByText('Finished')).toBeNull();

    // And the control agrees with the address rather than with a remembered
    // preference — a checkbox reading "on" over a list with nothing finished in
    // it would be the same lie in the other direction.
    expect(finishedToggle().checked).toBe(false);
  });

  /**
   * Quickstart B7's fourth write path, and the defect it caught.
   *
   * The list writes its query string from three controls, and **navigates away
   * from it by a fourth** — the row link. That link was `to="/items/KEY"`, a bare
   * string, and a string `to` discards the whole query string: selecting a row
   * silently cleared every filter, the search, and whether finished work was
   * shown. The list rearranged itself under the cursor at the exact moment the
   * engineer reached into it, which is 003's W2 promise ("one interaction to the
   * next item, and the list is where you left it") broken by the feature that
   * made the loss visible.
   *
   * It is the same defect as 003's, through the other door: 003 fixed the list
   * clobbering the detail's key and nobody checked the detail *link* clobbering
   * the list's. Both directions are now asserted — this test for going in, and
   * the one below it for coming back out.
   */
  it('keeps the list exactly as it was when a row is selected', async () => {
    mount(
      fleetBridge(fleetWithFinished()),
      '/?finished=1&repository=repo-foundry&q=the',
    );

    await within(listPane()).findByText('FDY-1');
    const before = rowKeys();
    // The arrangement is worth something: a filtered list including finished work.
    expect(before.length).toBeGreaterThan(1);
    expect(within(listPane()).getAllByText('Finished').length).toBeGreaterThan(0);

    await open('FDY-8');

    // The detail opened...
    expect(within(detailPane()).getByText('Crate the finished billet')).toBeDefined();
    // ...and nothing about the list moved. Not the rows, not the order, not the
    // control, not the address.
    expect(rowKeys()).toEqual(before);
    expect(finishedToggle().checked).toBe(true);
    expect(url()).toContain('finished=1');
    expect(url()).toContain('repository=repo-foundry');
    expect(url()).toContain('q=the');
  });

  it('keeps the list exactly as it was when the detail’s back link is followed', async () => {
    mount(
      fleetBridge(fleetWithFinished()),
      '/items/FDY-8?finished=1&repository=repo-foundry&tab=smelting',
    );

    await within(listPane()).findByText('FDY-8');
    const before = rowKeys();

    await userEvent.click(within(detailPane()).getByRole('link', { name: /all work items/i }));

    // At narrow widths this link is the only way back, so a list rearranged on
    // the way out would be the engineer's only remaining view of their work.
    expect(rowKeys()).toEqual(before);
    expect(finishedToggle().checked).toBe(true);
    expect(url()).toContain('finished=1');
    expect(url()).toContain('repository=repo-foundry');
    // The tab described an item that is no longer open, and does not travel.
    expect(url()).not.toContain('tab=');
  });

  /**
   * 004's T036, and quickstart B7 — the collision 003 shipped a defect into,
   * asserted against the fifth key.
   *
   * The list writes its own keys by deleting them all and setting the survivors,
   * which is what stopped it erasing the detail's `?tab=`. A new list-owned key
   * that is wired to a control but left out of that set appears to work: it
   * survives a filter change by accident, and is silently dropped the first time
   * the write path is reordered. So both directions are asserted, and all three
   * of the list's write paths are exercised — the select, the search field, and
   * the clear button — because the clear button is the one whose *correct*
   * behaviour differs. It must take the finished flag with it: including finished
   * work is a departure from the default view, and a control promising to restore
   * the ordinary list that left it wider would be the one filter escaping the one
   * control that undoes filters.
   *
   * The open tab is asserted by which tab is selected, not only by the URL. A tab
   * strip that reverted to the current state while `?tab=` stayed in the address
   * is exactly the shape of the 003 defect, and a URL-only assertion would have
   * been true throughout it.
   */
  it('lets the finished flag and the open item’s tab share one URL without either erasing the other', async () => {
    mount(fleetBridge(fleetWithFinished()), '/items/FDY-2?finished=1&tab=smelting');

    await within(listPane()).findByText('FDY-8');
    const openTab = () =>
      within(detailPane())
        .getAllByRole('tab')
        .find((tab) => tab.getAttribute('aria-selected') === 'true');

    // Smelting is behind FDY-2, so a tab that reverted to the current state would
    // be visibly a different tab rather than a coincidence.
    expect(openTab()?.textContent).toContain('Smelting');
    expect(finishedToggle().checked).toBe(true);

    // Write path one: the state select.
    await userEvent.selectOptions(within(listPane()).getByLabelText(/^state$/i), 'tempering');
    expect(url()).toContain('tab=smelting');
    expect(url()).toContain('state=tempering');
    expect(url()).toContain('finished=1');
    expect(openTab()?.textContent).toContain('Smelting');
    expect(finishedToggle().checked).toBe(true);

    // Write path two: a keystroke in the search box, which rewrites the query
    // string on every character and is the path an engineer hits first.
    await userEvent.type(within(listPane()).getByLabelText(/^search$/i), 'Temper');
    expect(url()).toContain('tab=smelting');
    expect(url()).toContain('q=Temper');
    expect(url()).toContain('finished=1');
    expect(openTab()?.textContent).toContain('Smelting');
    expect(finishedToggle().checked).toBe(true);

    // Write path three: clearing. The finished flag goes with the other filters,
    // and the arrangement — which is not a filter — does not.
    await userEvent.click(within(listPane()).getByRole('button', { name: /clear filters/i }));

    await within(listPane()).findByText('FDY-1');
    expect(url()).toBe('/items/FDY-2?tab=smelting');
    expect(openTab()?.textContent).toContain('Smelting');
    expect(finishedToggle().checked).toBe(false);
    expect(within(listPane()).queryByText('FDY-8')).toBeNull();
    expect(within(detailPane()).getByText('Temper the flywheel casting')).toBeDefined();
  });

  // ── Degrading honestly ────────────────────────────────────────────────────

  it('shows one pane at a time when the window is too narrow for two', async () => {
    stubWindowWidth(true);
    mount(fleetBridge());

    // FR-017, SC-007. jsdom measures nothing, so "neither pane is rendered
    // unusably narrow" cannot be asserted as a width. What can be asserted is
    // the structural claim the width would otherwise have to be trusted for: the
    // second pane is *absent*, not squeezed and not merely painted out while
    // still occupying the accessibility tree and the tab order. Exactly one pane
    // element exists, which is the honest fallback the contract asks for rather
    // than two unusable columns.
    expect(await screen.findByText('FDY-1')).toBeDefined();
    expect(document.querySelectorAll('.workbench__pane').length).toBe(1);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('main', { name: 'Item detail' })).toBeNull();
    // The pane on screen is the main content, which is what this product did as
    // two pages — the degradation reproduces rather than reinvents.
    expect(screen.getByRole('main', { name: 'Work items' })).toBeDefined();
    // Collapsing is meaningless with one pane; offering it would be a control
    // that gives the width to nothing.
    expect(screen.queryByRole('button', { name: /the work item list$/i })).toBeNull();

    // The rows are the explicit control to the other pane.
    await userEvent.click(screen.getByRole('link', { name: /FDY-1/ }));

    expect(document.querySelectorAll('.workbench__pane').length).toBe(1);
    expect(screen.getByRole('main', { name: 'Item detail' })).toBeDefined();
    expect(screen.queryByRole('main', { name: 'Work items' })).toBeNull();
    // And a named way back, so the one-pane arrangement is never a dead end.
    expect(await screen.findByRole('link', { name: /all work items/i })).toBeDefined();
  });

  it('names an item that is no longer there, and offers the way back', async () => {
    mount(fleetBridge(), '/items/FDY-404');

    // FR-018. An item that is *gone* is not an item that failed to load, and a
    // retry would be the wrong offer for something nobody is going to find.
    expect(await within(detailPane()).findByText('FDY-404 is no longer there')).toBeDefined();
    expect(
      within(detailPane()).getByText(/is not reported by any registered repository/i),
    ).toBeDefined();
    expect(within(detailPane()).getByText(/nothing has been lost on this side/i)).toBeDefined();

    const back = within(detailPane()).getByRole('link', { name: /back to the work item list/i });
    expect(back.getAttribute('href')).toBe('/');

    // Not a blank pane, and not a blank workbench either: the list is still
    // there to choose something that does exist.
    expect(rowKeys().length).toBe(4);
  });

  it('bounds the wait when a deep link arrives before anything has answered', async () => {
    vi.useFakeTimers();
    // Neither pane can answer. The detail is the one FR-020 is about: an
    // engineer who followed a link to an item arrives at a pane with nothing in
    // it yet, and Principle X forbids leaving them there indefinitely.
    mount(
      createBridgeStub({
        listItems: () => new Promise(() => undefined),
        getItem: () => new Promise(() => undefined),
      }),
      '/items/FDY-1',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Promptly pending, and announced rather than silently blank. The workbench's
    // own Suspense fallback covers only fetching the detail's chunk from local
    // disk; this is the provider-bound wait, which is the one with a ceiling.
    const pending = within(detailPane()).getByRole('status');
    expect(pending.textContent).toContain('Reconciling this work item');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // And bounded: a spinner without a ceiling is not permitted, and a failure
    // without a retry is not either.
    expect(within(detailPane()).queryByText(/reconciling this work item/i)).toBeNull();
    expect(within(detailPane()).getByText(/this is taking longer than it should/i)).toBeDefined();
    expect(within(detailPane()).getByRole('button', { name: /reload this item/i })).toBeDefined();
    // Each pane bounds its own wait, so a list that is still trying does not
    // hold the detail open and vice versa.
    expect(within(listPane()).getByRole('button', { name: /reload the list/i })).toBeDefined();
  });
});
