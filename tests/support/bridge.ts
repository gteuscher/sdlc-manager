/**
 * A stand-in for the IPC bridge, for component tests.
 *
 * Component tests run in jsdom with no Electron and no preload script, so
 * `window.dashboard` has to be installed by the test. Doing it through one helper
 * keeps every component test honest about the same thing: the renderer's entire
 * privilege set is these methods, so a component that needs something else has
 * found a hole in the contract rather than an inconvenience.
 */

import type { DashboardBridge } from '@core/ipc/bridge';
import type { ChangeEvent } from '@core/ipc/schema';

export interface BridgeStub {
  bridge: DashboardBridge;
  /** Fires a change event at every subscriber, as the main process would. */
  emit(event: ChangeEvent): void;
  /** Every call made, so a test can assert what the component asked for. */
  readonly calls: string[];
}

type Overrides = Partial<DashboardBridge>;

export function createBridgeStub(overrides: Overrides = {}): BridgeStub {
  const listeners = new Set<(event: ChangeEvent) => void>();
  const calls: string[] = [];

  const track = <T>(name: string, value: T): Promise<T> => {
    calls.push(name);
    return Promise.resolve(value);
  };

  const base: DashboardBridge = {
    listPackages: () => track('listPackages', []),
    // The three default locations, as `defaultPackageRoots()` produces them.
    packageSearchPaths: () =>
      track('packageSearchPaths', [
        '/home/dev/.claude/plugins',
        '/home/dev/.claude/skills',
        '/home/dev/.sdlc/packages',
      ]),
    listRepositories: () => track('listRepositories', []),
    listItems: () => track('listItems', []),
    getItem: () => track('getItem', { ok: false as const, reason: 'not_found' as const, message: 'no such item' }),
    getArtifact: () =>
      track('getArtifact', { ok: false as const, reason: 'not_found' as const, message: 'no such artifact' }),
    registerRepository: () =>
      track('registerRepository', { ok: false as const, reason: 'unavailable' as const, message: 'not stubbed' }),
    updateRepositoryConfig: () =>
      track('updateRepositoryConfig', { ok: false as const, reason: 'unavailable' as const, message: 'not stubbed' }),
    removeRepository: () => track('removeRepository', { ok: true as const, value: undefined }),
    setCredential: () => track('setCredential', { ok: true as const, value: undefined }),
    refresh: () => track('refresh', { ok: true as const, value: undefined }),
    onChanged: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    askConsole: () => track('askConsole', { ok: false as const, reason: 'unavailable' as const, message: 'not stubbed' }),
    getConversation: () => track('getConversation', []),
    // The shipped default: this application provisions no assistant, so every
    // test that does not say otherwise sees the console an engineer sees on
    // first run (FR-030, Principle I).
    consoleAvailable: () =>
      track('consoleAvailable', {
        providerId: 'console',
        kind: 'assistant',
        status: 'not_configured' as const,
        message: 'No assistant is configured for the console.',
        checkedAt: '2026-09-11T08:30:00.000Z',
      }),
  };

  const bridge: DashboardBridge = { ...base, ...overrides };

  return {
    bridge,
    calls,
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

/** Installs the stub on `window` and returns a teardown. */
export function installBridge(stub: BridgeStub): () => void {
  Object.defineProperty(window, 'dashboard', { value: stub.bridge, configurable: true, writable: true });
  return () => {
    Reflect.deleteProperty(window, 'dashboard');
  };
}
