/**
 * Every channel the bridge publishes, assembled in one place.
 *
 * `contracts/ipc-surface.md` §4 makes the point that the renderer's privilege set
 * is easier to verify as a closed list than as a set of prohibitions. This module
 * is that list in executable form: the channels registered here are exactly the
 * capabilities the renderer has, and `assertComplete` fails loudly if a channel
 * the contract declares has no handler — a silently unhandled channel would leave
 * the renderer with a method that hangs rather than one that answers.
 *
 * Every handler goes through `validated(...)`, so both directions are parsed
 * (rule 2), and every fallible one returns a `Result` rather than rejecting
 * (rule 5). The registry is injected, so the whole surface is exercisable in a
 * test with no Electron present (Principle IV, Principle VIII).
 */

import {
  CHANNELS,
  refreshScopeSchema,
  voidResultSchema,
  type RefreshScope,
} from '@core/ipc/schema.js';

import type { ConversationStore } from '../cache/conversations.js';
import type { Cache } from '../cache/index.js';
import type { Reconciler } from '../reconcile/index.js';
import type { Registry } from '../registry/index.js';
import type { SecretStore } from '../secrets/index.js';

import { createArtifactHandlers, type ArtifactHandlers } from './artifacts.js';
import { createConsoleHandlers, type ConsoleAssistant, type ConsoleHandlers } from './console.js';
import { createItemHandlers, type ItemHandlers } from './items.js';
import { createRepositoryHandlers, type RepositoryHandlers } from './repositories.js';
import {
  invalidRequestResult,
  register,
  validated,
  type IpcRegistry,
  type RegisteredChannel,
} from './validate.js';

/** `changed` is main-to-renderer and is emitted by the ChangeBus, not handled here. */
const EVENT_ONLY_CHANNELS: readonly string[] = [CHANNELS.changed];

export interface IpcDeps {
  readonly reconciler: Reconciler;
  readonly registry: Registry;
  readonly secrets: SecretStore;
  readonly cache: Cache;
  readonly conversations: ConversationStore;
  /** Where discovery looked for SDLC packages. Reported when it found none (Principle I). */
  readonly packageRoots: readonly string[];
  /** Absent by default: v1.0 ships no assistant provider (FR-030). */
  readonly assistant?: ConsoleAssistant | undefined;
  readonly now?: () => Date;
  readonly maxContentCharacters?: number;
}

export interface IpcHandlers {
  readonly items: ItemHandlers;
  readonly artifacts: ArtifactHandlers;
  readonly repositories: RepositoryHandlers;
  readonly console: ConsoleHandlers;
  /** Also carries `refresh`, which belongs to reconciliation rather than to a view. */
  readonly channels: readonly RegisteredChannel[];
}

export function createIpcHandlers(deps: IpcDeps): IpcHandlers {
  const items = createItemHandlers({ reconciler: deps.reconciler });
  const artifacts = createArtifactHandlers({
    reconciler: deps.reconciler,
    maxContentCharacters: deps.maxContentCharacters,
  });
  const repositories = createRepositoryHandlers({
    registry: deps.registry,
    secrets: deps.secrets,
    cache: deps.cache,
    reconciler: deps.reconciler,
    packageRoots: deps.packageRoots,
  });
  const consoleHandlers = createConsoleHandlers({
    reconciler: deps.reconciler,
    conversations: deps.conversations,
    assistant: deps.assistant,
    now: deps.now,
  });

  const channels: RegisteredChannel[] = [
    ...items.channels,
    ...artifacts.channels,
    ...repositories.channels,
    ...consoleHandlers.channels,
    createRefreshChannel(deps.reconciler),
  ];

  assertComplete(channels);

  return { items, artifacts, repositories, console: consoleHandlers, channels };
}

/** Binds every channel to a registry. `ipcMain` satisfies `IpcRegistry`. */
export function registerIpc(registry: IpcRegistry, deps: IpcDeps): IpcHandlers {
  const handlers = createIpcHandlers(deps);
  register(registry, handlers.channels);
  return handlers;
}

/**
 * `refresh` — FR-010's explicit path, and the retry every failed provider offers
 * (FR-019, FR-037, Principle X).
 *
 * It lives here rather than in a view's module because it belongs to
 * reconciliation, not to any one view: the items list, the detail view, and the
 * repositories view all call it.
 */
function createRefreshChannel(reconciler: Reconciler): RegisteredChannel {
  return {
    channel: CHANNELS.refresh,
    invoke: validated(
      CHANNELS.refresh,
      refreshScopeSchema.default({}),
      voidResultSchema,
      async (scope: RefreshScope) => reconciler.refresh(scope),
      invalidRequestResult<void>,
    ),
  };
}

/**
 * Fails loudly when the contract declares a channel nothing handles.
 *
 * A missing handler is our own bug, not a caller error, so it is an exception
 * rather than a `Result` — exactly the distinction `validated` draws between a
 * bad request and a bad reply.
 */
function assertComplete(channels: readonly RegisteredChannel[]): void {
  const handled = new Set(channels.map((entry) => entry.channel));
  const missing = Object.values(CHANNELS).filter(
    (channel) => !handled.has(channel) && !EVENT_ONLY_CHANNELS.includes(channel),
  );
  if (missing.length > 0) {
    throw new Error(
      `The IPC surface declares channels with no handler: ${missing.join(', ')}. ` +
        'Every method on DashboardBridge must be registered (ipc-surface.md §4).',
    );
  }
  const duplicates = channels
    .map((entry) => entry.channel)
    .filter((channel, index, all) => all.indexOf(channel) !== index);
  if (duplicates.length > 0) {
    throw new Error(`The IPC surface registers a channel twice: ${duplicates.join(', ')}.`);
  }
}
