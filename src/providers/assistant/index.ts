/**
 * T111 — the advisory console's backing assistant (Story 5, research.md §15).
 *
 * Behind the same adapter discipline as every other provider: constructed only
 * because something declares it, absent by default, and degrading in place rather
 * than failing. Treating it as a provider is what makes Principle I's
 * zero-credential start hold here for free — an unconfigured console reports
 * itself unavailable and the rest of the state tab renders normally (FR-030).
 *
 * It deliberately does **not** implement the `Provider` interface. That contract
 * is about reading work items — `discoverItems`, `readState`, `readGate` — and an
 * assistant answers none of those. Forcing it into that shape would mean five
 * methods that exist only to report that they do not apply, which is the
 * speculative abstraction Principle VII rejects. What it shares with `Provider`
 * is the discipline: typed failures, no throwing, no credential in a message.
 *
 * ## The limit, and why it is in the type
 *
 * v1.0's console is advisory (FR-031a): it answers questions about the state in
 * view and modifies nothing. `AssistantRequest` carries only the assembled
 * context and a question, and `ask` returns a `Message`. There is no tool, no
 * action, and no handle back into the application — so the advisory limit is
 * enforced by what the interface omits rather than by instructions to a model,
 * which is the only version of that limit that cannot be talked out of.
 *
 * The Planned Direction wants a supervised acting console later. That arrives as
 * a *new* capability on this interface, and nothing above changes.
 */

import type { GateResult, Message, ProviderHealth, Timestamp } from '@core/model/observed.js';
import { fail, ok, type Result } from '@core/model/result.js';
import { nowIso } from '../contract.js';

/** Everything the console is allowed to see: one state of one item (FR-031). */
export interface ConsoleContext {
  readonly itemKey: string;
  readonly itemTitle: string;
  /** The lifecycle's own noun, so the console calls a game a game. */
  readonly unit: string;
  readonly stateId: string;
  readonly stateName: string;
  readonly stateDescription: string | null;
  readonly gateResults: readonly GateResult[];
  /** Artifact text already read and rendered inert by the main process. */
  readonly artifacts: readonly { readonly name: string; readonly kind: string; readonly content: string }[];
  /** Prior turns, so a returning transcript continues rather than restarts. */
  readonly transcript: readonly Message[];
}

export interface AssistantRequest {
  readonly question: string;
  readonly context: ConsoleContext;
}

export interface AssistantProvider {
  readonly id: string;
  /** Configured and reachable? Never throws; reports instead. */
  health(): Promise<ProviderHealth>;
  ask(request: AssistantRequest): Promise<Result<Message>>;
}

export interface AssistantOptions {
  readonly id?: string;
  /** Where to send the request. Absent means no assistant is configured. */
  readonly endpoint?: string;
  readonly model?: string;
  readonly credential?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

/** Principle X's default ceiling on a bounded remote wait. */
const DEFAULT_TIMEOUT_MS = 10_000;

function message(role: Message['role'], content: string, at: Timestamp): Message {
  return { role, content, at };
}

/**
 * The default. No assistant is provisioned by this application (spec
 * §Assumptions), so with nothing configured the console must say so in place —
 * not fail, and not render a blank panel.
 */
export function createAbsentAssistant(options: { id?: string; now?: () => Date } = {}): AssistantProvider {
  const id = options.id ?? 'console';
  return {
    id,
    async health(): Promise<ProviderHealth> {
      return {
        providerId: id,
        kind: 'assistant',
        status: 'not_configured',
        message:
          'No assistant is configured for the console. Everything else in this state renders normally; configure one to ask questions about it.',
        checkedAt: nowIso(options.now),
      };
    },
    async ask(): Promise<Result<Message>> {
      return fail(
        'unavailable',
        'The console is unavailable because no assistant is configured. The rest of this state is unaffected.',
      );
    },
  };
}

/**
 * A configured assistant, reached over plain `fetch` like every other remote
 * adapter — no vendor SDK (Principle III).
 *
 * The request carries the assembled context and the question. It carries no
 * tools, because v1.0 grants none.
 */
export function createHttpAssistant(options: AssistantOptions): AssistantProvider {
  const id = options.id ?? 'console';
  const endpoint = options.endpoint;
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (endpoint === undefined || endpoint === '') {
    return createAbsentAssistant({ id, ...(options.now ? { now: options.now } : {}) });
  }

  /** Never let a credential reach a message the renderer or a log could see. */
  const scrub = (text: string): string =>
    options.credential === undefined || options.credential === ''
      ? text
      : text.split(options.credential).join('[redacted]');

  async function post(body: unknown): Promise<Result<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(endpoint as string, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The secret is a header and never a URL: a URL is what ends up in logs.
          ...(options.credential !== undefined ? { authorization: `Bearer ${options.credential}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return fail('unauthenticated', `The console's assistant rejected the configured credential.`);
      }
      if (response.status === 429) {
        return fail('rate_limited', `The console's assistant is rate limited. Try again shortly.`);
      }
      if (!response.ok) {
        return fail('unreachable', scrub(`The console's assistant answered with status ${response.status}.`));
      }
      return ok((await response.json()) as unknown);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail('unreachable', scrub(`The console's assistant could not be reached: ${detail}`));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id,

    async health(): Promise<ProviderHealth> {
      const at = nowIso(options.now);
      if (options.credential === undefined || options.credential === '') {
        return {
          providerId: id,
          kind: 'assistant',
          status: 'not_configured',
          message: `The console's assistant at ${endpoint} has no credential configured.`,
          checkedAt: at,
        };
      }
      return {
        providerId: id,
        kind: 'assistant',
        status: 'ok',
        message: `The console's assistant is configured at ${endpoint}.`,
        checkedAt: at,
      };
    },

    async ask(request: AssistantRequest): Promise<Result<Message>> {
      const at = nowIso(options.now);
      const replied = await post({
        ...(options.model !== undefined ? { model: options.model } : {}),
        question: request.question,
        context: request.context,
      });
      if (!replied.ok) return replied;

      const body = replied.value;
      const content =
        typeof body === 'object' && body !== null && typeof (body as { reply?: unknown }).reply === 'string'
          ? (body as { reply: string }).reply
          : undefined;

      if (content === undefined) {
        // A response that does not match its shape is a typed failure, never a
        // crash and never rendered raw (Principle IX).
        return fail('invalid_response', `The console's assistant returned a reply this application could not read.`);
      }

      return ok(message('assistant', content, at));
    },
  };
}
