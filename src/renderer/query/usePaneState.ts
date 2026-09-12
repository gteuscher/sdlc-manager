/**
 * T005 — the one piece of state this feature persists, and the one documented
 * exception to Principle XIII.
 *
 * Principle XIII says client state lives at the edge it is needed and that
 * anything global is a last resort requiring written justification. Here is the
 * justification, in full:
 *
 *   - FR-011 requires the collapse state to survive **restarts**, and a URL
 *     cannot do that. Selection, filters, search and the state tab all stay in
 *     the URL, where another person or another session can arrive at them; this
 *     one cannot go there, because it is not something anyone else should
 *     inherit from a shared link.
 *   - It is **not domain state.** It describes the engineer's furniture. Nothing
 *     derived from a system of record depends on it, and no state, gate, or
 *     provider is involved.
 *   - The alternative — a bridge method and a file in the main process — widens
 *     the renderer's privilege set (ipc-surface.md §4) for a boolean about a
 *     sidebar. Real cost, no gain.
 *
 * The dividing line the feature draws: **the URL holds what another person or
 * another session should be able to arrive at; local storage holds what only
 * this engineer at this desk cares about.**
 *
 * Nothing but the workbench shell reads this. No pane, and nothing in
 * `src/core`, `src/providers` or `src/main`, knows the value exists.
 *
 * **Every access is defensive, and every failure resolves to expanded.** Browser
 * storage can be absent, disabled, or throw on access, and the honest response to
 * "I could not find out what you preferred" is the arrangement in which nothing
 * is hidden. A workbench that opened with its primary pane collapsed because a
 * storage read threw would be undiscoverable for a reason the engineer could
 * never see.
 */

import { useCallback, useState } from 'react';

/** The persisted key. Named for the view that owns it, so an orphan is identifiable. */
export const LIST_COLLAPSED_KEY = 'sdlc.workbench.listCollapsed';

/**
 * Reads the preference, resolving every failure to `false` — expanded.
 *
 * Three things can go wrong and all three mean the same thing: the key is absent
 * (a first run), the accessor throws (storage disabled, or a sandboxed document
 * where touching `localStorage` is a `SecurityError`), or the value is something
 * other than the two strings written here (hand-edited, or written by a version
 * that did not exist yet). None of them is a reason to hide the list.
 */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(LIST_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Writes the preference, and swallows a failure.
 *
 * A storage quota or a disabled store must not take the toggle down with it: the
 * pane still collapses for this session, and the preference simply does not
 * survive the restart. Losing a remembered sidebar is a smaller harm than a
 * control that throws when clicked.
 */
function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(LIST_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Deliberately ignored — see above.
  }
}

export interface PaneState {
  /** Whether the list pane is collapsed. Absent or unreadable storage means `false`. */
  readonly collapsed: boolean;
  readonly setCollapsed: (next: boolean) => void;
  readonly toggle: () => void;
}

export function usePaneState(): PaneState {
  // A lazy initialiser, not a module-level read: Principle VIII prohibits
  // import-time side effects, and a value captured at import would be stale for
  // any test that seeded storage after loading the module.
  const [collapsed, setLocal] = useState<boolean>(readCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    setLocal(next);
    writeCollapsed(next);
  }, []);

  // Derived from `collapsed` rather than from a state updater: React invokes
  // updaters twice under StrictMode, and a write belongs outside one.
  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
