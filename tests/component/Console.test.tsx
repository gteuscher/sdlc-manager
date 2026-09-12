/**
 * T110 — User Story 5's console: scoped, restored, advisory, and — by default —
 * unavailable.
 *
 * Story 5's independent test is "open a state tab, hold a short conversation,
 * navigate to another item and back, and confirm the earlier conversation is
 * still present and distinct from other states' conversations", so the scoping
 * and restoration assertions below follow it literally: two consoles on two
 * states of one item, a question put to one of them, and a remount standing in
 * for leaving the tab and coming back.
 *
 * The heaviest assertion here is the unavailable one (FR-030). The application
 * ships with no assistant configured, so an engineer's *first* use of this
 * console is the failing path, and what it must do is report itself in place
 * while everything else on the tab stays exactly as it was. The siblings
 * rendered beside the console in that test are there to be asserted on: they
 * stand for the gates and artifacts that had nothing to do with the console and
 * must not be affected by it.
 *
 * Every state name, question, and answer below is invented. A test written
 * against the vocabulary in the specs would prove nothing about SC-003.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { Message, MessageRole, ProviderHealth } from '@core/model/observed';

import { Console } from '@renderer/components/Console';
import { createBridgeStub, installBridge, type BridgeStub } from '../support/bridge';

const AT = '2026-09-11T08:30:00.000Z';

const ITEM = 'LED-42';
const WEAVING = 'weaving';
const FULLING = 'fulling';

function said(role: MessageRole, content: string): Message {
  return { role, content, at: AT };
}

type Store = Record<string, Message[]>;

function scope(key: string, stateId: string): string {
  return `${key}::${stateId}`;
}

/** A configured, reachable assistant. Nothing in this application provisions one. */
const READY: ProviderHealth = {
  providerId: 'console',
  kind: 'assistant',
  status: 'ok',
  message: 'The console’s assistant is configured.',
  checkedAt: AT,
};

/** The shipped default, and therefore the first console every engineer meets. */
const ABSENT: ProviderHealth = {
  providerId: 'console',
  kind: 'assistant',
  status: 'not_configured',
  message:
    'No assistant is configured for the console. Everything else in this state renders normally; ' +
    'configure one to ask questions about it.',
  checkedAt: AT,
};

/**
 * A bridge that keeps one transcript per (item, state), exactly as the main
 * process does. It is the only way this test can tell a correctly scoped console
 * from one that happens to render the right thing.
 */
function conversing(store: Store, answer: (question: string) => string): BridgeStub {
  return createBridgeStub({
    consoleAvailable: () => Promise.resolve(READY),
    getConversation: (key, stateId) => Promise.resolve([...(store[scope(key, stateId)] ?? [])]),
    askConsole: (key, stateId, question) => {
      const at = scope(key, stateId);
      const reply = said('assistant', answer(question));
      store[at] = [...(store[at] ?? []), said('user', question), reply];
      return Promise.resolve({ ok: true as const, value: reply });
    },
  });
}

/** The reply a console with nothing configured behind it gets. This is the shipped default. */
const UNAVAILABLE =
  'No conversation assistant is configured, so the console cannot answer. Everything else in ' +
  'this state — its artifacts, its gates, and their results — is unaffected and still shown.';

let teardown: (() => void) | undefined;

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * The console in the document outline it actually lives in: inside a state's
 * panel, below that state's other sections. The siblings are real content so the
 * FR-030 assertions have something to check is still standing.
 */
function mount(
  stub: BridgeStub,
  states: readonly { readonly id: string; readonly name: string }[],
  queryClient: QueryClient = client(),
): { container: HTMLElement; unmount: () => void; queryClient: QueryClient } {
  teardown = installBridge(stub);
  const { container, unmount } = render(
    <QueryClientProvider client={queryClient}>
      <h1>Reconcile the ledger</h1>
      <h2>Weaving</h2>
      <h3>Gates</h3>
      <p>Tension held within the declared tolerance across all eight passes.</p>
      {states.map((state) => (
        <Console key={state.id} itemKey={ITEM} stateId={state.id} stateName={state.name} />
      ))}
    </QueryClientProvider>,
  );
  return { container, unmount, queryClient };
}

function transcript(name: string): HTMLElement {
  return screen.getByRole('log', { name: new RegExp(`conversation about ${name}`, 'i') });
}

beforeEach(() => {
  teardown = undefined;
});

afterEach(() => {
  teardown?.();
  vi.useRealTimers();
});

describe('the advisory console', () => {
  it('restores the transcript recorded for this state of this item', async () => {
    const store: Store = {
      [scope(ITEM, WEAVING)]: [
        said('user', 'Why has this been sitting here for three days?'),
        said('assistant', 'The countersignature has no recorded evaluation.'),
      ],
    };
    mount(conversing(store, () => 'unused'), [{ id: WEAVING, name: 'Weaving' }]);

    // FR-028: what was said before is what is shown on arrival.
    const log = within(transcript('Weaving'));
    expect(await screen.findByText(/why has this been sitting here for three days\?/i)).toBeDefined();
    expect(log.getByText(/the countersignature has no recorded evaluation/i)).toBeDefined();

    // A transcript in which the question and the answer look alike is not one.
    expect(log.getByText('You')).toBeDefined();
    expect(log.getByText('Console')).toBeDefined();
  });

  it('puts a reply in the console that asked for it and in no other', async () => {
    const store: Store = {};
    mount(
      conversing(store, (question) => `About the warp, not the nap: ${question}`),
      [
        { id: WEAVING, name: 'Weaving' },
        { id: FULLING, name: 'Fulling' },
      ],
    );

    const box = await screen.findByLabelText(/ask about weaving/i);
    await userEvent.type(box, 'What did the tension check actually measure?');
    await userEvent.click(screen.getByRole('button', { name: /^ask about weaving$/i }));

    // Story 5 acceptance 1: the reply lands in the console that asked.
    expect(await within(transcript('Weaving')).findByText(/about the warp, not the nap/i)).toBeDefined();

    // Story 5 acceptance 3, and the whole of FR-029: the other state's console
    // is untouched, and still says it has nothing.
    const other = within(transcript('Fulling'));
    expect(other.queryByText(/about the warp, not the nap/i)).toBeNull();
    expect(other.getByText(/nothing has been asked about fulling yet/i)).toBeDefined();

    // An answered question is cleared from the box; an unanswered one is not.
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('restores the conversation from cache when the tab is left and returned to', async () => {
    const store: Store = {
      [scope(ITEM, WEAVING)]: [said('assistant', 'The dye lot changed between passes four and five.')],
    };
    const shared = client();
    const stub = conversing(store, () => 'unused');

    const first = mount(stub, [{ id: WEAVING, name: 'Weaving' }], shared);
    expect(await screen.findByText(/the dye lot changed between passes four and five/i)).toBeDefined();

    // Leaving the tab: Radix unmounts the panel that is not selected, so the
    // console goes with it.
    first.unmount();
    teardown?.();
    expect(screen.queryByText(/the dye lot changed/i)).toBeNull();

    // Coming back. The assertion is deliberately synchronous: the transcript is
    // on screen in the first paint, from the query cache, without waiting on a
    // second read. That is what FR-028 asks for and what a component-held copy
    // could not do (Principle XIII).
    mount(stub, [{ id: WEAVING, name: 'Weaving' }], shared);
    expect(screen.getByText(/the dye lot changed between passes four and five/i)).toBeDefined();
  });

  it('reports its unavailability when the tab opens, before anything is asked', async () => {
    // The whole stub is the shipped default: nothing configured. This is what
    // every engineer sees on first run, which is why it is not an edge case.
    mount(createBridgeStub(), [{ id: WEAVING, name: 'Weaving' }]);

    // Principle I: an actionable prompt naming the missing provider, on open.
    // Nothing below is typed, clicked, or sent — this is the tab as it arrives.
    expect(await screen.findByText(/no assistant is configured for the console/i)).toBeDefined();
    expect(screen.getByText(/this console has no assistant to answer with/i)).toBeDefined();
    expect(screen.getByText('console')).toBeDefined();

    // FR-030's other half, and the one that is easy to lose: the console must
    // report itself without swallowing the tab around it.
    expect(screen.getByRole('heading', { name: 'Gates' })).toBeDefined();
    expect(screen.getByText(/tension held within the declared tolerance/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Console' })).toBeDefined();
    expect(screen.getByText(/nothing has been asked about weaving yet/i)).toBeDefined();

    // FR-034a: no inert box that will not work — and no silence either, so where
    // the assistant is configured is said instead.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/configured for this installation, outside this window/i)).toBeDefined();

    // Principle X: a way forward, and the shipped default announced as status
    // rather than fired at an engineer who has done nothing wrong.
    expect(screen.getByRole('button', { name: /check again/i })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens for questions once its assistant is configured', async () => {
    let configured = false;
    mount(
      createBridgeStub({
        consoleAvailable: () => Promise.resolve(configured ? READY : ABSENT),
      }),
      [{ id: WEAVING, name: 'Weaving' }],
    );

    await screen.findByText(/no assistant is configured for the console/i);

    // The retry is a real control with something behind it, not decoration.
    configured = true;
    await userEvent.click(screen.getByRole('button', { name: /check again/i }));

    expect(await screen.findByLabelText(/ask about weaving/i)).toBeDefined();
    expect(screen.queryByText(/no assistant is configured for the console/i)).toBeNull();
  });

  it('still reports in place when an assistant healthy at the probe fails at the question', async () => {
    let attempts = 0;
    mount(
      createBridgeStub({
        // The probe says the console is ready. FR-030 has to hold anyway: the
        // reply-driven path is a fallback the probe does not replace.
        consoleAvailable: () => Promise.resolve(READY),
        askConsole: (_key, _stateId, question) => {
          attempts += 1;
          if (attempts === 1) {
            return Promise.resolve({
              ok: false as const,
              reason: 'unavailable' as const,
              message: UNAVAILABLE,
            });
          }
          return Promise.resolve({
            ok: true as const,
            value: said('assistant', `Answering at last: ${question}`),
          });
        },
        getConversation: () =>
          Promise.resolve(attempts > 1 ? [said('assistant', 'Answering at last: Why is this blocked?')] : []),
      }),
      [{ id: WEAVING, name: 'Weaving' }],
    );

    const box = await screen.findByLabelText(/ask about weaving/i);
    await userEvent.type(box, 'Why is this blocked?');
    await userEvent.click(screen.getByRole('button', { name: /^ask about weaving$/i }));

    expect(await screen.findByText(/no conversation assistant is configured/i)).toBeDefined();
    // Nothing is lost: the question the engineer typed is still in the box.
    expect((box as HTMLTextAreaElement).value).toBe('Why is this blocked?');

    await userEvent.click(screen.getByRole('button', { name: /ask again/i }));

    expect(await screen.findByText(/answering at last: why is this blocked\?/i)).toBeDefined();
    expect(screen.queryByText(/no conversation assistant is configured/i)).toBeNull();
  });

  it('bounds a reply that never arrives, and offers a way to ask again', async () => {
    vi.useFakeTimers();
    mount(
      createBridgeStub({
        consoleAvailable: () => Promise.resolve(READY),
        askConsole: () => new Promise(() => undefined),
      }),
      [{ id: WEAVING, name: 'Weaving' }],
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const box = screen.getByLabelText(/ask about weaving/i);
    fireEvent.change(box, { target: { value: 'What is holding this up?' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask about weaving$/i }));

    // Promptly pending, which is the first half of Principle X.
    expect(screen.getByText(/waiting for an answer about weaving/i)).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // And bounded, which is the second half: a spinner without a ceiling is not
    // permitted, and a failure without a retry is not either.
    expect(screen.queryByText(/waiting for an answer about weaving/i)).toBeNull();
    expect(screen.getByText(/no answer has arrived within ten seconds/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /ask again/i })).toBeDefined();
  });

  it('renders a deliberate nothing before anything has been asked', async () => {
    mount(conversing({}, () => 'unused'), [{ id: WEAVING, name: 'Weaving' }]);

    // Principle X: no empty state without copy. This is the first thing an
    // engineer ever sees here, so it says what the console is scoped to.
    expect(await screen.findByText(/nothing has been asked about weaving yet/i)).toBeDefined();
    expect(within(transcript('Weaving')).queryByRole('list')).toBeNull();
  });

  it('offers no affordance suggesting it can change anything', async () => {
    mount(
      conversing({ [scope(ITEM, WEAVING)]: [said('assistant', 'The countersignature is owed.')] }, () => 'unused'),
      [{ id: WEAVING, name: 'Weaving' }],
    );
    await screen.findByText(/the countersignature is owed/i);

    // FR-031a. The only control is the one that asks a question — there is no
    // button here that looks like it will move the item or decide a gate, not
    // even a disabled one, because a disabled control implies the capability
    // exists and is merely unavailable.
    const names = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(names).toEqual(['Ask about Weaving']);

    // And it says so in words, since the enforcement lives in the main process
    // and is invisible from here.
    expect(screen.getByText(/this console is advisory/i)).toBeDefined();
    expect(screen.getByText(/answers with where that change is made/i)).toBeDefined();
  });

  it('has no detectable accessibility violations, answering or unavailable', async () => {
    const answering = mount(
      conversing(
        {
          [scope(ITEM, WEAVING)]: [
            said('user', 'What did the tension check measure?'),
            said('assistant', 'Tension across all eight passes, against the declared tolerance.'),
          ],
        },
        () => 'unused',
      ),
      [{ id: WEAVING, name: 'Weaving' }],
    );
    await screen.findByText(/against the declared tolerance/i);
    expect(await axe(answering.container)).toHaveNoViolations();
    answering.unmount();
    teardown?.();

    // FR-030's state is not exempt from Principle XI, and it is the one every
    // engineer meets first.
    const unavailable = mount(createBridgeStub(), [{ id: WEAVING, name: 'Weaving' }]);
    await screen.findByText(/no assistant is configured for the console/i);
    expect(await axe(unavailable.container)).toHaveNoViolations();
  });
});
