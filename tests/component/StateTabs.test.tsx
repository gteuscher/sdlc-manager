/**
 * T075, T080, T083, T084 — the state tabs, tested the only way the constitution
 * allows: through rendered output and user interaction (Principle IV). The single
 * seam is `window.dashboard`, which is the renderer's entire privilege set
 * (ipc-surface.md §4), so a component needing anything else would fail here
 * rather than quietly work.
 *
 * **The lifecycle below is invented, and that is the point.** SC-003 and SC-010
 * claim that a definition the application has never seen renders correctly with
 * no change to the application, and a test written against vocabulary that
 * appears in the specs would prove nothing about it. No state name, gate name,
 * or artifact name in this file appears anywhere in `src/renderer` — a lint rule
 * enforces that half, and this file is the other half of the proof.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { ReactElement } from 'react';

import { UNMAPPED } from '@core/model/observed';
import type {
  ArtifactRef,
  GateView,
  StateProgress,
  StateView,
  WorkItemDetail,
} from '@core/model/observed';

import ItemDetail from '@renderer/routes/ItemDetail';
import { createBridgeStub, installBridge, type BridgeStub } from '../support/bridge';

// ── An invented lifecycle ───────────────────────────────────────────────────

const RECONCILED = '2026-09-11T08:30:00.000Z';

/** Six states, in the order the manifest declares them. Nothing knows these but this file. */
const LIFECYCLE: readonly { id: string; name: string }[] = [
  { id: 'kindling', name: 'Kindling' },
  { id: 'shaping', name: 'Shaping' },
  { id: 'clearing', name: 'Clearing' },
  { id: 'weaving', name: 'Weaving' },
  { id: 'proofing', name: 'Proofing' },
  { id: 'dispatch', name: 'Dispatch' },
];

function gate(overrides: Partial<GateView> & { id: string; name: string }): GateView {
  return {
    kind: 'artifact',
    blocking: true,
    awaitsHuman: false,
    actionLocation: null,
    result: { gateId: overrides.id, status: 'passed', evaluatedAt: RECONCILED, evidence: null, detail: null },
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactRef> & { id: string; name: string }): ArtifactRef {
  return { kind: 'markdown', provider: 'ledger', required: false, ...overrides };
}

function state(
  index: number,
  progress: StateProgress,
  overrides: Partial<StateView> = {},
): StateView {
  const declared = LIFECYCLE[index];
  if (declared === undefined) throw new Error(`no state at ${index}`);
  return {
    id: declared.id,
    name: declared.name,
    description: null,
    ordinal: index,
    progress,
    awaitsHuman: false,
    terminal: index === LIFECYCLE.length - 1,
    gates: [],
    artifacts: [],
    ...overrides,
  };
}

/** The item sits in the fourth of six states — quickstart scenario V3. */
function fourthOfSix(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    item: {
      key: 'LED-42',
      title: 'Reconcile the ledger',
      repositoryId: 'repo-ledger',
      repositoryName: 'Ledger',
      packageId: 'pkg-ledger',
      sdlcName: 'Ledger lifecycle',
      unit: 'card',
      stateId: 'weaving',
      stateName: 'Weaving',
      rawState: 'weaving',
      attention: null,
      reconciledAt: RECONCILED,
      freshness: 'fresh',
      disagreements: [],
    },
    states: [
      state(0, 'completed'),
      state(1, 'completed'),
      state(2, 'completed'),
      state(3, 'current'),
      state(4, 'not_reached'),
      state(5, 'not_reached'),
    ],
    currentStateId: 'weaving',
    ...overrides,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

let teardown: (() => void) | undefined;

function mount(stub: BridgeStub, entry = '/items/LED-42'): { container: HTMLElement } {
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
          <Route path="/items/:key" element={<ItemDetail />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { container };
}

/** Renders the query string, so the URL is asserted as output rather than as internals. */
function LocationProbe(): ReactElement {
  const location = useLocation();
  return <p data-testid="query-string">{location.search}</p>;
}

function stubFor(detail: WorkItemDetail, overrides: Parameters<typeof createBridgeStub>[0] = {}) {
  return createBridgeStub({
    getItem: () => Promise.resolve({ ok: true as const, value: detail }),
    ...overrides,
  });
}

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
}

function selectedTab(): HTMLElement {
  const selected = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true');
  const first = selected[0];
  if (first === undefined) throw new Error('no tab is selected');
  return first;
}

beforeEach(() => {
  teardown = undefined;
});

afterEach(() => {
  teardown?.();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('the item detail state tabs', () => {
  it('presents one tab per declared state, in lifecycle order, and opens on the state the item occupies', async () => {
    mount(stubFor(fourthOfSix()));

    await screen.findByRole('tablist');

    // FR-011: six tabs, the definition's order, the definition's names.
    expect(tabNames().map((text) => text.replace(/Completed|Current|Not reached/g, ''))).toEqual(
      LIFECYCLE.map((declared) => declared.name),
    );

    // FR-012: opened on the fourth, not the first.
    expect(selectedTab().textContent).toContain('Weaving');
    expect(screen.getByRole('tabpanel').textContent).toContain('Weaving');
  });

  it('marks how far the item has travelled, in words as well as in shape', async () => {
    const { container } = mount(stubFor(fourthOfSix()));

    await screen.findByRole('tablist');
    const tabs = within(screen.getByRole('tablist'));

    // FR-013, and the cue that survives greyscale: four different words.
    expect(tabs.getAllByText('Completed').length).toBe(3);
    expect(tabs.getAllByText('Current').length).toBe(1);
    expect(tabs.getAllByText('Not reached').length).toBe(2);

    // And a different drawn mark per value, so they stay separable without text
    // and without colour: three distinct shapes for the three values present.
    const marks = [...container.querySelectorAll('.tabs__trigger .state-marker__mark')].map(
      (svg) => svg.innerHTML,
    );
    expect(new Set(marks).size).toBe(3);
  });

  it('moves between tabs with the arrow keys, keeping focus and selection together', async () => {
    mount(stubFor(fourthOfSix()));

    await screen.findByRole('tablist');

    // Reachable by keyboard alone (Principle XI): the first stop is the link back
    // to the list, the second is the tab strip — which takes a single stop in the
    // tab order, as the WAI-ARIA tabs pattern requires.
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(selectedTab());

    // And arrows move within it, carrying selection with focus.
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toContain('Proofing');
    expect(selectedTab().textContent).toContain('Proofing');
    expect(screen.getByRole('tabpanel').textContent).toContain('Proofing');

    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement?.textContent).toContain('Weaving');
    expect(selectedTab().textContent).toContain('Weaving');

    await userEvent.keyboard('{Home}');
    expect(document.activeElement?.textContent).toContain('Kindling');

    await userEvent.keyboard('{End}');
    expect(document.activeElement?.textContent).toContain('Dispatch');
  });

  it('puts the selected state in the URL', async () => {
    mount(stubFor(fourthOfSix()));

    await screen.findByRole('tablist');
    await userEvent.click(screen.getByRole('tab', { name: /Clearing/ }));

    // FR-015, Principle XIII: a state view is a link, not a piece of hidden state.
    expect(screen.getByTestId('query-string').textContent).toContain('state=clearing');
    expect(selectedTab().textContent).toContain('Clearing');
  });

  it('opens on the state the URL names, so a state view can be returned to directly', async () => {
    mount(stubFor(fourthOfSix()), '/items/LED-42?state=dispatch');

    await screen.findByRole('tablist');
    // The URL wins over the state the item occupies — that is what "returned to
    // directly" means, and it is the last of Story 2's acceptance scenarios.
    expect(selectedTab().textContent).toContain('Dispatch');
    expect(screen.getByRole('tabpanel').textContent).toContain('Dispatch');
  });

  it('shows no artifacts for a state the item has not reached, and reads none', async () => {
    const detail = fourthOfSix();
    const withDeclared: WorkItemDetail = {
      ...detail,
      states: detail.states.map((declared) =>
        declared.id === 'proofing'
          ? { ...declared, artifacts: [artifact({ id: 'proof-sheet', name: 'Proof sheet', required: true })] }
          : declared,
      ),
    };
    const stub = stubFor(withDeclared);
    mount(stub, '/items/LED-42?state=proofing');

    await screen.findByRole('tablist');

    // Story 2 acceptance 4: marked not reached, and nothing fabricated for it.
    expect(screen.getByText(/has not reached this state/i)).toBeDefined();
    expect(screen.getByText('Proof sheet')).toBeDefined();
    // The declaration is read from the manifest; the content is never requested.
    expect(stub.calls).not.toContain('getArtifact');
  });

  it('names where an action is performed instead of offering a control that does nothing', async () => {
    const detail = fourthOfSix();
    const withOwedAction: WorkItemDetail = {
      ...detail,
      item: {
        ...detail.item,
        attention: {
          kind: 'gate_failed',
          reason: 'The countersignature check did not pass.',
          stateId: 'weaving',
          gateId: 'countersign',
        },
      },
      states: detail.states.map((declared) =>
        declared.id === 'weaving'
          ? {
              ...declared,
              progress: 'blocked' as const,
              gates: [
                gate({
                  id: 'countersign',
                  name: 'Countersignature',
                  kind: 'manual',
                  awaitsHuman: true,
                  actionLocation: 'Countersign the card in the Ledger board, then re-run the harness.',
                  result: {
                    gateId: 'countersign',
                    status: 'failed',
                    evaluatedAt: RECONCILED,
                    evidence: null,
                    detail: 'No countersignature was recorded.',
                  },
                }),
              ],
            }
          : declared,
      ),
    };
    mount(stubFor(withOwedAction));

    await screen.findByRole('tablist');

    // FR-034a: a sentence saying where, not a button that cannot act.
    expect(
      screen.getByText(/countersign the card in the ledger board/i),
    ).toBeDefined();
    expect(screen.getByText(/never writes to them/i)).toBeDefined();
    expect(
      screen.queryByRole('button', { name: /approve|advance|override|re-?run|transition/i }),
    ).toBeNull();
  });

  it('reports an item whose recorded state no longer exists, without dropping or reassigning it', async () => {
    const base = fourthOfSix();
    const upgraded: WorkItemDetail = {
      item: {
        ...base.item,
        stateId: UNMAPPED,
        stateName: null,
        rawState: 'Countersigning',
      },
      // The package was upgraded and the state the item rested in is gone, so
      // none of the surviving states claims it.
      states: base.states.map((declared) => ({ ...declared, progress: 'not_reached' as const })),
      currentStateId: null,
    };
    mount(stubFor(upgraded));

    await screen.findByRole('tablist');

    // FR-046, FR-005: the raw value, exactly as recorded, and an explanation.
    expect(screen.getAllByText('Countersigning').length).toBeGreaterThan(0);
    expect(screen.getByText('Unmapped')).toBeDefined();
    expect(screen.getByText(/no matching state in the version of/i)).toBeDefined();

    // Not reassigned: still six tabs, and not one of them is marked as current.
    expect(screen.getAllByRole('tab').length).toBe(6);
    expect(within(screen.getByRole('tablist')).queryAllByText('Current').length).toBe(0);
  });

  it('offers a retry when the item itself could not be loaded', async () => {
    let attempts = 0;
    mount(
      createBridgeStub({
        getItem: () => {
          attempts += 1;
          if (attempts === 1) {
            return Promise.resolve({
              ok: false as const,
              reason: 'unreachable' as const,
              message: 'The Ledger source is unreachable.',
            });
          }
          return Promise.resolve({ ok: true as const, value: fourthOfSix() });
        },
      }),
    );

    expect(await screen.findByText(/this work item could not be loaded/i)).toBeDefined();
    expect(screen.getByText(/the ledger source is unreachable/i)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: /reload this item/i }));
    expect(await screen.findByRole('tablist')).toBeDefined();
  });

  it('has no detectable accessibility violations', async () => {
    const detail = fourthOfSix();
    const populated: WorkItemDetail = {
      ...detail,
      states: detail.states.map((declared) =>
        declared.id === 'weaving'
          ? {
              ...declared,
              description: 'The card is being woven into the ledger.',
              gates: [
                gate({ id: 'shape', name: 'Shape check' }),
                gate({
                  id: 'countersign',
                  name: 'Countersignature',
                  kind: 'manual',
                  awaitsHuman: true,
                  actionLocation: 'Countersign the card in the Ledger board.',
                  result: {
                    gateId: 'countersign',
                    status: 'not_evaluated',
                    evaluatedAt: null,
                    evidence: null,
                    detail: null,
                  },
                }),
              ],
              artifacts: [artifact({ id: 'weave-notes', name: 'Weave notes' })],
            }
          : declared,
      ),
    };

    const { container } = mount(
      stubFor(populated, {
        getArtifact: () =>
          Promise.resolve({
            ok: true as const,
            value: {
              artifactId: 'weave-notes',
              kind: 'markdown',
              provider: 'ledger',
              locator: 'docs/weave-notes.md',
              content: '# Weave notes\n\nThe warp is set.',
              reconciledAt: RECONCILED,
              truncated: false,
              byteLength: 32,
            },
          }),
      }),
    );

    await screen.findByRole('tablist');
    await screen.findByText(/the warp is set/i);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
