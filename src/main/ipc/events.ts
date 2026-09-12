/**
 * T046 — change-event emission.
 *
 * Events are **invalidations, not payloads**. They name what changed; the
 * renderer re-reads through its query cache (ipc-surface.md §3).
 *
 * The reason is worth stating because the alternative is tempting: pushing the
 * changed items with the event would save a round trip, and would also give the
 * renderer a second source of truth alongside its cache. That is exactly the
 * divergence Principle VI warns about for the system of record and Principle XIII
 * warns about for client state. So this module can only send the four event
 * shapes the contract declares, and the schema parse below is what enforces it —
 * an event carrying an item would be rejected before it left the process.
 *
 * This is also what satisfies FR-010 without a restart: a `chokidar` watch or a
 * poll tick emits an invalidation, and the renderer refetches the affected keys.
 */

import { changeEventSchema, type ChangeEvent } from '@core/ipc/schema.js';

export type ChangeListener = (event: ChangeEvent) => void;
export type Unsubscribe = () => void;

export interface ChangeBus {
  /** Publishes an invalidation. A malformed event is dropped, never sent. */
  emit(event: ChangeEvent): void;
  /** Local subscription, for the main process's own reactions. */
  subscribe(listener: ChangeListener): Unsubscribe;
  /** Coalesces a burst of file events into one invalidation. */
  emitDebounced(key: string, event: ChangeEvent, delayMs?: number): void;
  /** Releases every pending timer. */
  dispose(): void;
}

export interface ChangeBusOptions {
  /** How the event reaches the renderer — `webContents.send`, wired by the composition root. */
  send: (event: ChangeEvent) => void;
  /** Where a contract violation is reported. Never receives provider content. */
  onInvalid?: (message: string) => void;
  defaultDebounceMs?: number;
}

export function createChangeBus(options: ChangeBusOptions): ChangeBus {
  const listeners = new Set<ChangeListener>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const defaultDebounceMs = options.defaultDebounceMs ?? 150;

  const emit = (event: ChangeEvent): void => {
    const parsed = changeEventSchema.safeParse(event);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      options.onInvalid?.(
        `refusing to emit a change event that does not match the contract: ${issue?.path.join('.')} ${issue?.message}`,
      );
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(parsed.data);
      } catch {
        // One bad local subscriber must not stop the fan-out, and there is no
        // Result to carry the failure on a void callback.
      }
    }
    options.send(parsed.data);
  };

  return {
    emit,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    emitDebounced(key, event, delayMs) {
      const existing = timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.delete(key);
        emit(event);
      }, delayMs ?? defaultDebounceMs);
      // A pending invalidation must not hold the process open.
      timer.unref?.();
      timers.set(key, timer);
    },

    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      listeners.clear();
    },
  };
}
