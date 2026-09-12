/**
 * T042 — the composition root.
 *
 * Everything the main process is made of is constructed here, explicitly, once.
 * Nothing below is a module-level variable, and nothing runs at import time
 * (Principle VIII): `createServices` builds the graph and hands it back, and
 * `bootstrap` is the only function that knows Electron exists.
 *
 * ## Why `deps` is injectable down to the clock and the network
 *
 * `userDataDir`, the `safeStorage` backend, the package roots, and `fetch` all
 * arrive as arguments, so the **entire** object graph — registry, cache,
 * transition log, conversation store, secret store, all three providers, the
 * reconciler, and every IPC handler — is constructible in a unit test with no
 * Electron runtime present (Principle IV). That is the property that makes the
 * IPC surface testable as a surface rather than only through a window.
 *
 * Electron is reached **only** through `await import('electron')` inside
 * `bootstrap()`. A static import here would pull a runtime into every test that
 * touches the composition root, and would make this file unloadable outside one.
 *
 * ## Zero-config boot is a gate (FR-035, SC-006)
 *
 * The application must start with no repositories registered and no credentials
 * configured. Every step below is written for that case first: an empty registry
 * lists nothing, a package root that does not exist is skipped rather than an
 * error, and a lifecycle declaring an unconfigured provider produces a
 * `ProviderHealth` naming that provider rather than a crash, a blank screen, or a
 * silent empty state.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChangeEvent } from '@core/ipc/schema.js';
import { CHANNELS } from '@core/ipc/schema.js';
import type { SdlcDefinition, SdlcPackage } from '@core/model/declared.js';

import { createConversationStore, type ConversationStore } from './cache/conversations.js';
import { createCache, type Cache } from './cache/index.js';
import { createTransitionLog, type TransitionLog } from './cache/transitions.js';
import { defaultPackageRoots } from './discovery/scan.js';
import { createChangeBus, type ChangeBus } from './ipc/events.js';
import { createIpcHandlers, type IpcHandlers } from './ipc/index.js';
import type { ConsoleAssistant } from './ipc/console.js';
import { register, type IpcRegistry } from './ipc/validate.js';
import { createProviderSet, type ProviderFactories } from './providers.js';
import { createReconciler, type Reconciler } from './reconcile/index.js';
import { createRegistry, type Registry } from './registry/index.js';
import { createSecretStore, type SafeStorageLike, type SecretStore } from './secrets/index.js';
import { createMainWindow } from './window.js';

export interface ServiceDeps {
  /** Where local configuration and the cache live. Electron's `userData` in production. */
  readonly userDataDir: string;
  /** Electron's `safeStorage` in production, a reversible fake in a test. */
  readonly safeStorage: SafeStorageLike;
  /** Overrides the machine's default SDLC package locations. */
  readonly packageRoots?: readonly string[];
  /** Injected so no test performs a live network call (Principle III). */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  /** How an invalidation reaches the renderer. A no-op until a window exists. */
  readonly send?: (event: ChangeEvent) => void;
  /** Absent by default: v1.0 ships no assistant provider (FR-030, FR-031a). */
  readonly assistant?: ConsoleAssistant | undefined;
  /** Where a contract violation is reported. Never receives provider content or a secret. */
  readonly onInvalid?: (message: string) => void;
  /** Injected so a test can supply packages without scanning a filesystem. */
  readonly scan?: (roots: readonly string[]) => Promise<SdlcPackage[]>;
  /** Injected so a test can supply provider fakes in place of the real adapters. */
  readonly providerFactories?: ProviderFactories;
  readonly debounceMs?: number;
}

export interface Services {
  readonly registry: Registry;
  readonly cache: Cache;
  readonly transitions: TransitionLog;
  readonly conversations: ConversationStore;
  readonly secrets: SecretStore;
  readonly bus: ChangeBus;
  readonly reconciler: Reconciler;
  readonly handlers: IpcHandlers;
  /** Binds every channel to an `ipcMain`-shaped registry. */
  registerWith(registry: IpcRegistry): void;
  /** Loads registrations and packages, reconciles, and subscribes to providers. */
  start(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Wires the whole main process. All three providers are wired explicitly, by
 * `createProviderSet`, from the kinds a manifest declares — an unknown kind is
 * absent and reported, never fatal.
 */
export function createServices(deps: ServiceDeps): Services {
  const registry = createRegistry(deps.userDataDir);
  const cache = createCache(deps.userDataDir);
  const transitions = createTransitionLog(cache.root);
  const conversations = createConversationStore(cache.root);
  const secrets = createSecretStore(deps.userDataDir, deps.safeStorage);

  const bus = createChangeBus({
    send: deps.send ?? (() => undefined),
    onInvalid: deps.onInvalid,
  });

  // Hoisted rather than computed inline, because two things need the same
  // answer: discovery scans these, and the repositories view names them when it
  // finds nothing (Principle I — an empty state that cannot be acted on is not
  // an actionable prompt).
  const packageRoots = deps.packageRoots ?? defaultPackageRoots();

  const reconciler = createReconciler({
    registry,
    cache,
    transitions,
    bus,
    packageRoots,
    scan: deps.scan,
    now: deps.now,
    debounceMs: deps.debounceMs,
    providersFor: (definition: SdlcDefinition, config: Readonly<Record<string, unknown>>) =>
      createProviderSet(definition, config, {
        factories: deps.providerFactories,
        // The one path a credential travels: store to factory. It never reaches a
        // log line, a `Result` message, or the IPC surface (Principle III,
        // ipc-surface.md rule 3).
        credentialFor: (providerId: string) => secrets.get(providerId),
        fetch: deps.fetch ?? globalThis.fetch,
        now: deps.now,
      }),
  });

  const handlers = createIpcHandlers({
    reconciler,
    registry,
    secrets,
    cache,
    conversations,
    packageRoots,
    assistant: deps.assistant,
    now: deps.now,
  });

  return {
    registry,
    cache,
    transitions,
    conversations,
    secrets,
    bus,
    reconciler,
    handlers,

    registerWith(ipc: IpcRegistry): void {
      register(ipc, handlers.channels);
    },

    async start(): Promise<void> {
      await reconciler.start();
    },

    async dispose(): Promise<void> {
      await reconciler.dispose();
      bus.dispose();
    },
  };
}

/**
 * The Electron entry point's one job, exported so `src/main/entry.ts` is a single
 * call.
 *
 * The window is created **before** reconciliation runs. A first reconciliation
 * can take as long as the slowest provider, and an application that showed
 * nothing until then would be the blank frame Principle X forbids; the window
 * opens on its empty states and fills in as invalidations arrive.
 */
export async function bootstrap(): Promise<void> {
  // The only reference to Electron in `src/main` outside `entry.ts` and
  // `window.ts`'s own dynamic import. Do not hoist it.
  const { app, BrowserWindow, ipcMain, safeStorage } = await import('electron');

  await app.whenReady();

  /**
   * Invalidations, never payloads (ipc-surface.md §3). Windows are looked up on
   * each send rather than captured, so nothing here holds a handle that could
   * outlive its window — and no module-level mutable state is needed to track one.
   */
  const send = (event: ChangeEvent): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(CHANNELS.changed, event);
    }
  };

  const services = createServices({
    userDataDir: app.getPath('userData'),
    safeStorage,
    send,
    fetch: globalThis.fetch,
    onInvalid: (message: string) => {
      // Carries no provider content and no credential by construction — the bus
      // only ever reports that an event did not match its own contract.
      process.stderr.write(`${message}\n`);
    },
  });

  services.registerWith(ipcMain);

  await createMainWindow(preloadPath(), process.env);

  // Zero-config boot (FR-035, SC-006): with no repositories and no credentials
  // there is nothing to reconcile, and this completes immediately. A failure here
  // must still leave a usable window, so it is reported rather than thrown.
  try {
    await services.start();
  } catch (error) {
    process.stderr.write(
      `Initial reconciliation did not complete: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    void createMainWindow(preloadPath(), process.env);
  });

  app.on('window-all-closed', () => {
    // macOS convention: the app stays resident with no window. Everywhere else,
    // closing the window is quitting.
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    // Releases every chokidar watch and poll timer a provider opened.
    void services.dispose();
  });
}

/**
 * Where the compiled preload sits, resolved from this module rather than from the
 * working directory, which a packaged launch does not control.
 *
 * Two shapes, because this module is read in two: bundled to `dist/main.cjs`,
 * where the directory *is* `dist`; and as source at `src/main/index.ts`, where
 * `dist` is two levels up. The same resolution `window.ts` uses for the renderer.
 */
function preloadPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDirectory =
    path.basename(here) === 'dist' ? here : path.resolve(here, '..', '..', 'dist');
  return path.join(distDirectory, 'preload.cjs');
}
