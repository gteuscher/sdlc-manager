/**
 * T044 — the contextBridge surface.
 *
 * This file is the renderer's complete privilege set. Every capability the
 * renderer has is a method below; there is no other path between the processes
 * (contracts/ipc-surface.md §4). A feature needing something not here requires a
 * new method with its own validation and its own review against the hardening
 * constraint — never a widening of renderer privileges.
 *
 * It is deliberately thin. The preload runs with `sandbox: true` and is the most
 * privileged code the renderer can reach, so it does no parsing, no mapping, and
 * no business logic: it forwards. Validation happens at the two ends that consume
 * the data — the main process parses every inbound request, the renderer parses
 * every inbound reply (ipc-surface.md rule 2). Putting a schema library in here
 * would enlarge the sandboxed attack surface to no benefit.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Imported from `channels.js` rather than `schema.js` on purpose: a sandboxed
// preload can require only a few Electron built-ins, never a sibling chunk, so
// this file must bundle to something that depends on nothing but `electron`.
import { CHANNELS } from '../core/ipc/channels.js';
import type { DashboardBridge } from '../core/ipc/bridge.js';

export function createBridge(): DashboardBridge {
  return {
    listPackages: () => ipcRenderer.invoke(CHANNELS.listPackages),
    // Where discovery looked, so an empty result can say so (Principle I).
    packageSearchPaths: () => ipcRenderer.invoke(CHANNELS.packageSearchPaths),
    listRepositories: () => ipcRenderer.invoke(CHANNELS.listRepositories),
    listItems: (filter) => ipcRenderer.invoke(CHANNELS.listItems, filter ?? {}),
    getItem: (key) => ipcRenderer.invoke(CHANNELS.getItem, { key }),
    getArtifact: (key, stateId, artifactId) =>
      ipcRenderer.invoke(CHANNELS.getArtifact, { key, stateId, artifactId }),

    // Local application configuration only. No method here writes to a system of
    // record — read-only is the absence of the capability (FR-034, rule 1).
    registerRepository: (input) => ipcRenderer.invoke(CHANNELS.registerRepository, input),
    updateRepositoryConfig: (id, config) => ipcRenderer.invoke(CHANNELS.updateRepositoryConfig, { id, config }),
    removeRepository: (id) => ipcRenderer.invoke(CHANNELS.removeRepository, { id }),
    // Passes a secret in. Nothing returns one (rule 3).
    setCredential: (providerId, secret) => ipcRenderer.invoke(CHANNELS.setCredential, { providerId, secret }),

    refresh: (scope) => ipcRenderer.invoke(CHANNELS.refresh, scope ?? {}),

    onChanged: (callback) => {
      // Events are invalidations, not payloads: the renderer is told what changed
      // and re-reads, so it never gains a second source of truth (§3).
      const listener = (_event: IpcRendererEvent, payload: unknown): void => {
        callback(payload as Parameters<typeof callback>[0]);
      };
      ipcRenderer.on(CHANNELS.changed, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.changed, listener);
      };
    },

    askConsole: (key, stateId, message) => ipcRenderer.invoke(CHANNELS.askConsole, { key, stateId, message }),
    getConversation: (key, stateId) => ipcRenderer.invoke(CHANNELS.getConversation, { key, stateId }),
    // A status report, like the ones already on every repository. No secret
    // travels in either direction (rule 3).
    consoleAvailable: () => ipcRenderer.invoke(CHANNELS.consoleAvailable),
  };
}

// The preload script *is* the side effect: exposing the bridge at load time is the
// only moment the renderer's world can be populated. Lint permits a top-level call
// here and in `src/main/entry.ts`, and nowhere else.
contextBridge.exposeInMainWorld('dashboard', createBridge());
