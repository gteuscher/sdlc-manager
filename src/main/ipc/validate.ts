/**
 * T045 — Zod validation of IPC payloads in both directions.
 *
 * The renderer is an untrusted producer to the main process; and the main
 * process's replies carry provider data that was itself untrusted. Validating
 * only inbound traffic would leave the second hop unchecked (ipc-surface.md
 * rule 2, Principle IX).
 *
 * So a handler registered here parses its argument on receipt *and* its reply
 * before sending. The two failures mean different things and are treated
 * differently:
 *
 *   - a bad **request** is a caller error, and becomes a `Result` failure the
 *     renderer can render (rule 5 — failures are values, never a rejected
 *     promise carrying a stack);
 *   - a bad **reply** is our own bug, and is loud, because a malformed reply
 *     means the main process constructed something that does not match the
 *     contract it publishes.
 *
 * Nothing here imports Electron: the registry is an interface, so every handler
 * is unit-testable without a runtime (Principle IV).
 */

import type { z } from 'zod';

import { fail, type Result } from '@core/model/result.js';

/** The shape of `ipcMain`, narrowed to what this module uses. */
export interface IpcRegistry {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export type Handler<TArgs, TReply> = (args: TArgs) => Promise<TReply>;

export class ReplyContractError extends Error {
  constructor(channel: string, detail: string) {
    super(`IPC reply on "${channel}" does not match its published schema: ${detail}`);
    this.name = 'ReplyContractError';
  }
}

/**
 * Wraps a handler so both directions are parsed.
 *
 * `onInvalidRequest` decides what a rejected request becomes. Channels returning
 * `Result` hand back a typed failure; channels returning a plain list hand back
 * an empty one, because a list route has no way to carry a failure and an empty
 * list is the honest answer to a request we refused to understand.
 */
export function validated<TArgsSchema extends z.ZodTypeAny, TReply>(
  channel: string,
  argsSchema: TArgsSchema,
  replySchema: z.ZodTypeAny,
  handler: Handler<z.infer<TArgsSchema>, TReply>,
  onInvalidRequest: (message: string, field?: string) => TReply,
): (raw: unknown) => Promise<TReply> {
  return async (raw: unknown): Promise<TReply> => {
    const parsedArgs = argsSchema.safeParse(raw);
    if (!parsedArgs.success) {
      const issue = parsedArgs.error.issues[0];
      const field = issue?.path.join('.');
      const message = issue === undefined ? 'the request did not match its schema' : `${field}: ${issue.message}`;
      return onInvalidRequest(message, field === '' ? undefined : field);
    }

    const reply = await handler(parsedArgs.data);

    const parsedReply = replySchema.safeParse(reply);
    if (!parsedReply.success) {
      const issue = parsedReply.error.issues[0];
      throw new ReplyContractError(
        channel,
        issue === undefined ? 'unknown mismatch' : `${issue.path.join('.')}: ${issue.message}`,
      );
    }

    return reply;
  };
}

/** For channels whose reply is a `Result`: a rejected request is a typed failure. */
export function invalidRequestResult<T>(message: string, field?: string): Result<T> {
  return fail('invalid_input', message, field === undefined ? undefined : { field });
}

/** For channels whose reply is a plain list: a rejected request yields nothing. */
export function invalidRequestEmpty<T>(): T[] {
  return [];
}

export interface RegisteredChannel {
  readonly channel: string;
  readonly invoke: (raw: unknown) => Promise<unknown>;
}

/** Binds validated handlers to a registry. The registry is injected, so tests need no Electron. */
export function register(registry: IpcRegistry, channels: readonly RegisteredChannel[]): void {
  for (const { channel, invoke } of channels) {
    registry.handle(channel, async (_event: unknown, ...args: unknown[]) => invoke(args[0]));
  }
}
