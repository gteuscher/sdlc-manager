/**
 * T076 — the single most important assertion in User Story 2: a gate with no
 * recorded evaluation is a **distinct third value**, never a pass.
 *
 * SC-005 puts a number on it — 100% of gates displayed as passed correspond to a
 * recorded passing evaluation, and no gate lacking a result is ever displayed as
 * passed — and Principle V states the rule directly: absence of a result is
 * never treated as success. Getting this wrong is worse than a missing feature,
 * because it tells an engineer that something was checked when nothing was.
 *
 * So the three statuses are asserted to differ in **text and in shape**, not in
 * colour. Colour is untestable here (jsdom computes no styles) and would be
 * inadmissible even if it were: a greyscale display, a colour-blind reader, and
 * a screen reader all have to arrive at the same three answers.
 *
 * The gates below are invented, as they must be — a test written against the
 * vocabulary in the specs would prove nothing about SC-003's claim that an
 * unfamiliar definition renders correctly.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { GateView } from '@core/model/observed';

import { GateList } from '@renderer/components/GateList';

const EVALUATED = '2026-09-11T08:30:00.000Z';

function gate(overrides: Partial<GateView> & { id: string; name: string }): GateView {
  return {
    kind: 'artifact',
    blocking: true,
    awaitsHuman: false,
    actionLocation: null,
    result: {
      gateId: overrides.id,
      status: 'passed',
      evaluatedAt: EVALUATED,
      evidence: null,
      detail: null,
    },
    ...overrides,
  };
}

/** One of each status, which is the whole of the contract: there is no fourth. */
const THREE_STATUSES: readonly GateView[] = [
  gate({
    id: 'weave-tension',
    name: 'Weave tension',
    result: {
      gateId: 'weave-tension',
      status: 'passed',
      evaluatedAt: EVALUATED,
      evidence: { provider: 'ledger', locator: 'checks/weave-tension' },
      detail: 'Tension held within the declared tolerance across all eight passes.',
    },
  }),
  gate({
    id: 'countersign',
    name: 'Countersignature',
    kind: 'manual',
    awaitsHuman: true,
    actionLocation: 'Countersign the card in the Ledger board.',
    result: {
      gateId: 'countersign',
      status: 'failed',
      evaluatedAt: EVALUATED,
      evidence: null,
      detail: 'The recorded countersignature does not match the card’s owner.',
    },
  }),
  gate({
    id: 'dye-lot',
    name: 'Dye lot check',
    blocking: false,
    result: {
      gateId: 'dye-lot',
      // The case this whole file exists for.
      status: 'not_evaluated',
      evaluatedAt: null,
      evidence: null,
      detail: null,
    },
  }),
];

function gateItems(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

describe('gate results', () => {
  it('renders every declared gate, whatever the definition called them', () => {
    render(<GateList gates={THREE_STATUSES} />);

    expect(gateItems().length).toBe(3);
    expect(screen.getByText('Weave tension')).toBeDefined();
    expect(screen.getByText('Countersignature')).toBeDefined();
    expect(screen.getByText('Dye lot check')).toBeDefined();
  });

  it('renders a gate with no recorded evaluation as a distinct third status, never as passed', () => {
    render(<GateList gates={THREE_STATUSES} />);

    // Three different words. This is the cue that survives greyscale, and the
    // only one a screen reader gets.
    expect(screen.getByText('Passed')).toBeDefined();
    expect(screen.getByText('Failed')).toBeDefined();
    expect(screen.getByText('Not evaluated')).toBeDefined();

    // SC-005: exactly one gate is described as passing, and it is the one with a
    // recorded passing evaluation.
    expect(screen.getAllByText('Passed').length).toBe(1);
    const unevaluated = gateItems()[2];
    expect(unevaluated).toBeDefined();
    const scoped = within(unevaluated as HTMLElement);
    expect(scoped.getByText('Dye lot check')).toBeDefined();
    expect(scoped.queryByText('Passed')).toBeNull();
    expect(scoped.getByText('Not evaluated')).toBeDefined();
    expect(scoped.getByText(/never evaluated/i)).toBeDefined();
  });

  it('distinguishes the three statuses by drawn shape as well as by word', () => {
    const { container } = render(<GateList gates={THREE_STATUSES} />);

    const marks = [...container.querySelectorAll('.gate__mark')].map((svg) => svg.innerHTML);
    expect(marks.length).toBe(3);
    // Three different drawings, so the statuses stay separable with the text
    // hidden and with every colour stripped out.
    expect(new Set(marks).size).toBe(3);
  });

  it('says why each gate passed or failed, and says plainly when there is no why to give', () => {
    render(<GateList gates={THREE_STATUSES} />);

    // Principle V: the interface says why.
    expect(screen.getByText(/tension held within the declared tolerance/i)).toBeDefined();
    expect(screen.getByText(/does not match the card’s owner/i)).toBeDefined();

    // And an unevaluated gate gets copy rather than an empty slot, because a
    // blank explanation beside a gate reads as approval (Principle X).
    expect(
      screen.getByText(/no evaluation has been recorded for this gate.*this is not a pass/i),
    ).toBeDefined();
  });

  it('shows the recorded evidence as text, since the renderer cannot resolve a locator', () => {
    render(<GateList gates={THREE_STATUSES} />);

    // ipc-surface.md rule 4: shown, never linked — there is no capability behind it.
    expect(screen.getByText('checks/weave-tension')).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('offers no control for anything the dashboard cannot do', () => {
    render(<GateList gates={THREE_STATUSES} />);

    // FR-034: v1.0 is read-only, and a disabled button would imply otherwise.
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  it('renders a deliberate nothing for a state that declares no gates', () => {
    render(<GateList gates={[]} />);

    // Principle X: no empty state without copy.
    expect(screen.getByText(/declares no gates/i)).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<GateList gates={THREE_STATUSES} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
