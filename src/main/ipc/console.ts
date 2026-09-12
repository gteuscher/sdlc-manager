/**
 * T113, T115 — the advisory console channels.
 *
 * ## T115 is the important half: the console is advisory in v1.0 (FR-031a)
 *
 * It answers questions about the state in view. It **executes no tool** and
 * **modifies no work item, repository, artifact, or configuration**. A request to
 * change something is answered by naming where that change must be made.
 *
 * That is enforced structurally rather than by instruction, because an
 * instruction to a language model is not a guarantee:
 *
 *   1. The `ConsoleAssistant` interface below takes plain data and returns a
 *      string. It is handed no provider, no store, no file handle, and no
 *      callback — there is nothing in scope for it to act *through*. Read-only is
 *      the absence of the capability here exactly as it is in the provider
 *      contract (FR-034).
 *   2. A message that asks for a change is answered by this module itself, from
 *      the loaded manifest, and the assistant is never consulted for it. The
 *      answer names the provider and locator where the action is actually
 *      performed — which is the same thing `GateView.actionLocation` tells the
 *      interface (FR-034a).
 *
 * ## Unavailable is a first-class state (FR-030)
 *
 * The assistant is an injected optional dependency and its **absence is the
 * default**: this application provisions none. So unavailability is reported on
 * two channels, not one, and the difference matters.
 *
 *   - `consoleAvailable` is the *probe*. It answers before anything is asked,
 *     with the same `ProviderHealth` every other provider publishes, so a state
 *     tab can say on open that the console cannot answer and name what is
 *     missing. Principle I requires exactly that — an actionable prompt naming
 *     the missing provider, never a silent empty state — and a console that
 *     accepts a question and only then admits it cannot answer is that silent
 *     empty state, for every engineer, on first run.
 *   - `askConsole` still reports it too, because an assistant can be configured
 *     and healthy at the probe and fail at the question.
 *
 * Either way the rest of the state tab renders normally: the console's
 * unavailability is reported in place, not as an empty frame (Principle X).
 *
 * ## Scope (FR-029)
 *
 * One conversation per state per item. The scoping is the storage path, so two
 * states of one item cannot reach each other's transcript because they cannot
 * name each other's file.
 */

import { z } from 'zod';

import {
  CHANNELS,
  askConsoleArgSchema,
  consoleAvailabilityReplySchema,
  conversationArgSchema,
  conversationReplySchema,
  messageResultSchema,
} from '@core/ipc/schema.js';
import { findState, type SdlcDefinition, type State } from '@core/model/declared.js';
import {
  isUnmapped,
  type ArtifactRef,
  type AttentionSignal,
  type GateView,
  type Message,
  type ProviderHealth,
} from '@core/model/observed.js';
import { fail, ok, type Result } from '@core/model/result.js';
import { createAbsentAssistant } from '@providers/assistant/index.js';
import { nowIso } from '@providers/contract.js';

import type { ConversationStore } from '../cache/conversations.js';
import type { ItemContext, Reconciler } from '../reconcile/index.js';

import { stateViewFor } from './items.js';
import {
  invalidRequestEmpty,
  invalidRequestResult,
  validated,
  type RegisteredChannel,
} from './validate.js';

/**
 * Everything the console is allowed to know: the state it is scoped to, that
 * state's artifacts, and that state's gate results (FR-031).
 *
 * Plain serialisable data, deliberately. An assistant given a provider could read
 * beyond its scope; an assistant given a callback could act.
 */
export interface ConsoleContext {
  readonly itemKey: string;
  readonly unit: string;
  readonly title: string;
  readonly sdlcName: string;
  readonly repositoryName: string;
  readonly stateId: string;
  readonly stateName: string;
  readonly stateDescription: string | null;
  readonly stateAwaitsHuman: boolean;
  readonly isCurrentState: boolean;
  readonly rawState: string;
  readonly attention: AttentionSignal | null;
  readonly artifacts: readonly ArtifactRef[];
  readonly gates: readonly GateView[];
  readonly history: readonly Message[];
}

/**
 * The advisory assistant, injected and optional.
 *
 * One method, taking data and returning text. No tool list, no handle, no write
 * path — the interface is the enforcement (FR-031a).
 */
export interface ConsoleAssistant {
  /**
   * Configured and reachable? Never throws; reports instead.
   *
   * A `ProviderHealth` rather than a boolean, because Principle I requires the
   * interface to name the missing provider and say what it needs, and a boolean
   * cannot carry either. It is the same report every other provider publishes,
   * and like those it carries no credential.
   */
  health(): Promise<ProviderHealth>;
  /** Answers a question about the state in view. Advisory only. */
  answer(context: ConsoleContext, question: string): Promise<Result<string>>;
}

export interface ConsoleHandlerDeps {
  readonly reconciler: Reconciler;
  readonly conversations: ConversationStore;
  /** Absent by default: v1.0 ships no assistant provider. */
  readonly assistant?: ConsoleAssistant | undefined;
  readonly now?: () => Date;
}

export interface ConsoleHandlers {
  askConsole(args: { key: string; stateId: string; message: string }): Promise<Result<Message>>;
  getConversation(args: { key: string; stateId: string }): Promise<Message[]>;
  /** Whether the console can answer, reported before anything is asked (FR-030). */
  consoleAvailable(): Promise<ProviderHealth>;
  readonly channels: readonly RegisteredChannel[];
}

/** Why the console reports itself unavailable, said in full so the tab can render it. */
const UNAVAILABLE_MESSAGE =
  'No conversation assistant is configured, so the console cannot answer. Everything else in ' +
  'this state — its artifacts, its gates, and their results — is unaffected and still shown. ' +
  'The transcript of any earlier conversation is kept.';

/** A health channel answers with a health report even when the request was nonsense. */
const noArgsSchema = z.undefined();

export function createConsoleHandlers(deps: ConsoleHandlerDeps): ConsoleHandlers {
  /**
   * The probe (FR-030, Principle I).
   *
   * With nothing injected, the answer is `createAbsentAssistant()`'s own report —
   * surfaced rather than restated, so the copy an engineer reads on first run has
   * exactly one author. An assistant that throws when asked about itself is an
   * assistant that cannot be relied on to answer, and is reported as unreachable
   * rather than allowed to propagate.
   */
  const consoleAvailable = async (): Promise<ProviderHealth> => {
    const assistant = deps.assistant;
    if (assistant === undefined) {
      return createAbsentAssistant(deps.now === undefined ? {} : { now: deps.now }).health();
    }
    try {
      return await assistant.health();
    } catch (error) {
      return {
        providerId: 'console',
        kind: 'assistant',
        status: 'unreachable',
        message:
          `The console's assistant could not report its own status: ${describeError(error)}. ` +
          'Everything else in this state is unaffected.',
        checkedAt: nowIso(deps.now),
      };
    }
  };

  const askConsole = async (args: {
    key: string;
    stateId: string;
    message: string;
  }): Promise<Result<Message>> => {
    const scoped = scopeFor(deps.reconciler, args.key, args.stateId);
    if (!scoped.ok) return scoped;

    const history = await deps.conversations.read(args.key, args.stateId);
    const context = buildContext(scoped.value.entry, scoped.value.state, history);

    // T115. A request to change something is answered here, from the manifest,
    // and the assistant is never consulted for it. The console cannot make the
    // change, so the useful answer is where it *is* made (FR-031a, FR-034a).
    if (requestsChange(args.message)) {
      return record(deps, args, advisoryRefusal(context, scoped.value.entry.repository.definition));
    }

    const assistant = deps.assistant;
    if (assistant === undefined) {
      // Reported in place, with the rest of the tab untouched (FR-030). The probe
      // above means an engineer should rarely reach this, but it stays: an
      // assistant configured between the probe and the question must still fail
      // here rather than anywhere else.
      return fail('unavailable', UNAVAILABLE_MESSAGE);
    }

    const health = await consoleAvailable();
    if (health.status !== 'ok') {
      // The health report already names the provider and what it needs
      // (Principle I), so it is passed through rather than restated.
      return fail('unavailable', health.message);
    }

    let answered: Result<string>;
    try {
      answered = await assistant.answer(context, args.message);
    } catch (error) {
      answered = fail(
        'unavailable',
        `The conversation assistant failed to answer: ${describeError(error)}. The rest of this state is unaffected.`,
      );
    }
    if (!answered.ok) return answered;

    return record(deps, args, answered.value);
  };

  const getConversation = async (args: { key: string; stateId: string }): Promise<Message[]> =>
    // Read straight from the store: a transcript is scoped by (item, state) and
    // must survive its item temporarily dropping off the list (FR-028, FR-029).
    deps.conversations.read(args.key, args.stateId);

  const channels: RegisteredChannel[] = [
    {
      channel: CHANNELS.askConsole,
      invoke: validated(
        CHANNELS.askConsole,
        askConsoleArgSchema,
        messageResultSchema,
        askConsole,
        invalidRequestResult<Message>,
      ),
    },
    {
      channel: CHANNELS.getConversation,
      invoke: validated(
        CHANNELS.getConversation,
        conversationArgSchema,
        conversationReplySchema,
        getConversation,
        invalidRequestEmpty<Message>,
      ),
    },
    {
      channel: CHANNELS.consoleAvailable,
      invoke: validated(
        CHANNELS.consoleAvailable,
        noArgsSchema,
        consoleAvailabilityReplySchema,
        consoleAvailable,
        // A channel whose reply is a status report answers a malformed request
        // with a status report: there is no other shape it may return, and a
        // console whose request could not be read cannot be said to be working.
        (message: string): ProviderHealth => ({
          providerId: 'console',
          kind: 'assistant',
          status: 'unreachable',
          message: `The console's status could not be checked: ${message}.`,
          checkedAt: nowIso(deps.now),
        }),
      ),
    },
  ];

  return { askConsole, getConversation, consoleAvailable, channels };
}

// ── Scoping ──────────────────────────────────────────────────────────────────

interface ScopedState {
  readonly entry: ItemContext;
  readonly state: State;
}

function scopeFor(
  reconciler: Reconciler,
  key: string,
  stateId: string,
): Result<ScopedState> {
  const entry = reconciler.find(key);
  if (entry === undefined) {
    return fail('not_found', `No item with key "${key}" is currently listed.`, { field: 'key' });
  }
  const definition = entry.repository.definition;
  if (definition === null) {
    return fail(
      'unavailable',
      entry.repository.repository.problem ??
        'This repository has no usable lifecycle manifest, so it declares no state to scope a console to.',
    );
  }
  const state = findState(definition, stateId);
  if (state === undefined) {
    return fail(
      'not_found',
      `This lifecycle declares no state with id "${stateId}".`,
      { field: 'stateId' },
    );
  }
  return ok({ entry, state });
}

function buildContext(
  entry: ItemContext,
  state: State,
  history: readonly Message[],
): ConsoleContext {
  const { item, repository } = entry;
  const definition = repository.definition;
  const view =
    definition === null
      ? { gates: [], artifacts: [] }
      : stateViewFor(definition, state, item.gateResults);

  return {
    itemKey: item.key,
    unit: item.unit,
    title: item.title,
    sdlcName: repository.pkg?.name ?? item.packageId,
    repositoryName: repository.repository.name,
    stateId: state.id,
    stateName: state.name,
    stateDescription: state.description ?? null,
    stateAwaitsHuman: state.awaitsHuman,
    isCurrentState: !isUnmapped(item.stateId) && item.stateId === state.id,
    rawState: item.rawState,
    attention: item.attention,
    artifacts: view.artifacts,
    gates: view.gates,
    history,
  };
}

// ── The advisory limit (T115) ────────────────────────────────────────────────

/**
 * Verbs that, in an imperative or a direct request, ask the console to *do*
 * something rather than explain something.
 *
 * Deliberately verbs only. A lifecycle noun here would be lifecycle vocabulary
 * hardcoded into the application, which Principle II forbids — and would also be
 * wrong, since every lifecycle names its stages differently.
 */
const CHANGE_VERBS = [
  'add',
  'advance',
  'apply',
  'approve',
  'assign',
  'cancel',
  'change',
  'clear',
  'close',
  'commit',
  'complete',
  'create',
  'delete',
  'disable',
  'edit',
  'enable',
  'execute',
  'finish',
  'fix',
  'flip',
  'ignore',
  'install',
  'mark',
  'merge',
  'modify',
  'move',
  'override',
  'promote',
  'publish',
  'push',
  'reassign',
  'rename',
  'reopen',
  'rerun',
  're-run',
  'reset',
  'resolve',
  'restart',
  'retry',
  'revert',
  'run',
  'save',
  'set',
  'skip',
  'start',
  'submit',
  'sync',
  'tick',
  'toggle',
  'transition',
  'trigger',
  'unassign',
  'update',
  'upload',
  'write',
].join('|');

/**
 * True when the message asks the console to change something.
 *
 * The verb must be in an imperative or a direct-request position, so "why did
 * this fail?" and "what should I change here?" are questions, while "approve the
 * gate" and "can you re-run the checks" are requests. Ambiguity resolves towards
 * answering with *where the change is made*, which is useful either way and never
 * results in something being changed.
 */
export function requestsChange(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (text === '') return false;

  const imperative = new RegExp(`^(?:please\\s+|just\\s+|now\\s+|go\\s+ahead\\s+and\\s+)*(?:${CHANGE_VERBS})\\b`);
  if (imperative.test(text)) return true;

  const request = new RegExp(
    `\\b(?:can|could|would|will|please)\\s+(?:you\\s+)?(?:please\\s+|just\\s+)?(?:${CHANGE_VERBS})\\b`,
  );
  if (request.test(text)) return true;

  const iWant = new RegExp(
    `\\b(?:i\\s+(?:want|need|would\\s+like)\\s+(?:you\\s+)?to|let'?s|lets)\\s+(?:${CHANGE_VERBS})\\b`,
  );
  return iWant.test(text);
}

/**
 * The answer to a request to change something: what the console is, and **where
 * that change is performed** (FR-031a, FR-034a).
 *
 * Built from the manifest, so it names the right place for a lifecycle this build
 * has never seen.
 */
export function advisoryRefusal(
  context: ConsoleContext,
  definition: SdlcDefinition | null,
): string {
  const lines: string[] = [
    `This console is advisory. It reads this ${context.unit} and answers questions about it; ` +
      'it changes nothing — not this ' +
      `${context.unit}, not its repository, not its artifacts, and not this application's ` +
      'configuration — and it runs no tool on your machine.',
  ];

  // Where the outstanding actions in this state are actually performed.
  const owed = context.gates.filter((gate) => gate.actionLocation !== null);
  if (owed.length > 0) {
    lines.push('', `Outstanding in ${context.stateName}, and where each is done:`);
    for (const gate of owed) {
      lines.push(`- ${gate.actionLocation ?? gate.name}`);
    }
  }

  const owner = definition?.ownership.state;
  if (owner !== undefined) {
    lines.push(
      '',
      `This ${context.unit}'s status is recorded by the '${owner}' provider, which currently ` +
        `reports "${context.rawState === '' ? 'nothing' : context.rawState}". Any change to it is ` +
        'made there, and this dashboard will show it at the next reconciliation.',
    );
  }

  return lines.join('\n');
}

// ── Transcript ───────────────────────────────────────────────────────────────

/** Appends the exchange and returns the assistant's message (FR-028). */
async function record(
  deps: ConsoleHandlerDeps,
  args: { key: string; stateId: string; message: string },
  content: string,
): Promise<Result<Message>> {
  const at = nowIso(deps.now);
  const question: Message = { role: 'user', content: args.message, at };
  const answer: Message = { role: 'assistant', content, at: nowIso(deps.now) };

  try {
    await deps.conversations.append(args.key, args.stateId, question);
    await deps.conversations.append(args.key, args.stateId, answer);
  } catch {
    // The transcript is a cache, not the answer. Failing to persist it costs the
    // history, never the reply the engineer is waiting for.
  }

  return ok(answer);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
