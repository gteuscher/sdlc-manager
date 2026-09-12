/**
 * T006 — the collapse preference, which is this feature's single documented
 * exception to Principle XIII and therefore the single place it can go wrong.
 *
 * ## Why this file exists
 *
 * `usePaneState` is four lines of logic guarding a failure mode that is invisible
 * once it happens. Every path through it resolves to *expanded* except one, and
 * the reason is stated in data-model.md §Persistence shape: a workbench that opens
 * with its primary pane hidden is not discoverable. If a storage read throws in a
 * sandboxed document and the hook answers "collapsed", the engineer sees an empty
 * frame with no list, no error, and no clue — the application looks broken in a
 * way that no error boundary catches and no log records. That is the bug this file
 * is here to prevent, so the tests are weighted heavily towards the failures
 * rather than towards the happy path.
 *
 * ## How it is tested
 *
 * Through a probe component and rendered output, never through the hook object.
 * Principle IV forbids reaching into internals, and `renderHook` is exactly that:
 * it asserts on a return value no user can see. The probe below renders the one
 * fact that matters as text and exposes the two mutators as buttons, so every
 * assertion here is a statement about what an engineer would observe. A remount is
 * how "persisted" is tested, because a remount is what a restart is.
 *
 * The one exception is the last describe block, which asserts a fact about the
 * repository rather than about a render: that no file in `src/` but the hook
 * itself mentions the key. That claim cannot be made from inside a render — it is
 * about the *absence* of other readers — so it is made the way
 * `tests/unit/dogfood.speckit.test.ts` makes its structural claims, by reading the
 * source tree.
 *
 * jsdom supplies a real `localStorage`, so nothing here fakes the store; only the
 * accessors are broken, and only where a broken accessor is the subject.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReactElement } from 'react';

import { LIST_COLLAPSED_KEY, usePaneState } from '@renderer/query/usePaneState';

// ── Probe ───────────────────────────────────────────────────────────────────

/**
 * The hook's entire observable surface, rendered.
 *
 * `collapsed` is printed as a word rather than a boolean so a failure message
 * reads as the thing that went wrong ("expected collapsed, got expanded") instead
 * of as "expected true, got false", which says nothing about which is the safe
 * answer.
 */
function Probe(): ReactElement {
  const { collapsed, setCollapsed, toggle } = usePaneState();
  return (
    <div>
      <p data-testid="pane">{collapsed ? 'collapsed' : 'expanded'}</p>
      <button type="button" onClick={toggle}>
        toggle the list
      </button>
      <button type="button" onClick={() => setCollapsed(true)}>
        collapse the list
      </button>
      <button type="button" onClick={() => setCollapsed(false)}>
        expand the list
      </button>
    </div>
  );
}

/** What the probe currently says. */
function pane(): string {
  return screen.getByTestId('pane').textContent ?? '';
}

/**
 * An accessor that fails the way a disabled or sandboxed store fails: by
 * throwing on touch, not by returning `null`. `null` is the ordinary absent-key
 * answer and would prove nothing about the `catch`.
 *
 * It is installed on `Storage.prototype`, never on `window.localStorage`. jsdom's
 * `localStorage` is a Proxy whose `defineProperty` trap treats an unrecognised
 * property as a *stored item*: `vi.spyOn(window.localStorage, 'setItem')` quietly
 * writes a key literally called `setItem` into the store, leaves the real method
 * reachable through the prototype, and records zero calls. Every assertion in
 * this block would then pass without the `catch` ever running. The prototype is
 * the seam that actually intercepts, and each test below asserts the spy was
 * called so that a future change to that plumbing fails loudly instead of turning
 * these tests green and empty.
 */
function refuse(): never {
  throw new DOMException('Access to storage is not allowed from this context.', 'SecurityError');
}

/** The keys the store actually holds, read through the Storage API rather than as an object. */
function storedKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  // Restore before clearing: a test that broke `getItem` must not leave the next
  // one reading through a spy.
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// ── Reading a preference that was never validly written ─────────────────────

describe('a preference that cannot be read', () => {
  it('opens expanded on a first run, when the key is absent', () => {
    expect(window.localStorage.getItem(LIST_COLLAPSED_KEY)).toBeNull();

    render(<Probe />);

    // data-model.md rule 1. The list is the discoverable arrangement, so absence
    // resolves to it rather than to the last-written-looking value.
    expect(pane()).toBe('expanded');
  });

  it('opens expanded when the stored value is not one of the two strings it writes', () => {
    // Hand-edited, or written by a version of this application that does not
    // exist yet. Neither is a reason to hide the list.
    for (const garbage of ['yes', '', 'TRUE', '1', 'collapsed', 'null']) {
      window.localStorage.setItem(LIST_COLLAPSED_KEY, garbage);
      const { unmount } = render(<Probe />);
      expect(pane(), `stored value ${JSON.stringify(garbage)}`).toBe('expanded');
      unmount();
    }
  });

  it('opens collapsed for the one value that means collapsed, so "expanded" is not the only answer available', () => {
    // Without this the whole block above would pass against a hook hardcoded to
    // `false`, and would be testing nothing.
    window.localStorage.setItem(LIST_COLLAPSED_KEY, 'true');
    render(<Probe />);
    expect(pane()).toBe('collapsed');
  });
});

// ── Storage that throws ─────────────────────────────────────────────────────

describe('storage that throws on access', () => {
  it('renders expanded rather than propagating the failure', () => {
    // Seeded with the one value that means collapsed, so the assertion below
    // discriminates: a hook that read successfully would say "collapsed", and
    // only a hook that caught the failure can say "expanded".
    window.localStorage.setItem(LIST_COLLAPSED_KEY, 'true');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);

    // If the read were undefended this would throw during render, which in the
    // real shell means a blanked pane rather than a wrong default.
    expect(() => render(<Probe />)).not.toThrow();
    expect(getItem).toHaveBeenCalledWith(LIST_COLLAPSED_KEY);
    expect(pane()).toBe('expanded');
  });

  it('leaves the toggle working when the read is broken', async () => {
    window.localStorage.setItem(LIST_COLLAPSED_KEY, 'true');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    const user = userEvent.setup();

    render(<Probe />);
    expect(getItem).toHaveBeenCalled();
    expect(pane()).toBe('expanded');

    // An unreadable preference is a reason to pick a safe default, not a reason
    // to take the control down with it.
    await user.click(screen.getByRole('button', { name: 'toggle the list' }));
    expect(pane()).toBe('collapsed');
  });

  it('collapses for this session when the write is broken, and simply does not remember', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    const user = userEvent.setup();

    const { unmount } = render(<Probe />);
    await user.click(screen.getByRole('button', { name: 'toggle the list' }));

    // The session honours the click — losing a remembered sidebar is a smaller
    // harm than a control that throws when pressed.
    expect(pane()).toBe('collapsed');
    expect(setItem).toHaveBeenCalledWith(LIST_COLLAPSED_KEY, 'true');

    // And nothing was persisted, because nothing could be.
    setItem.mockRestore();
    expect(storedKeys()).toEqual([]);

    unmount();
    render(<Probe />);
    expect(pane()).toBe('expanded');
  });
});

// ── A write, read back ──────────────────────────────────────────────────────

describe('a preference that was written', () => {
  it('survives a remount, which is the only thing FR-011 actually asks for', async () => {
    const user = userEvent.setup();

    const { unmount } = render(<Probe />);
    expect(pane()).toBe('expanded');
    await user.click(screen.getByRole('button', { name: 'toggle the list' }));
    expect(pane()).toBe('collapsed');

    // A remount is a restart as far as this hook can tell: a fresh initialiser
    // reading the store it left behind.
    unmount();
    render(<Probe />);
    expect(pane()).toBe('collapsed');
  });

  it('remembers being expanded again, so the preference is not one-way', async () => {
    const user = userEvent.setup();

    const { unmount } = render(<Probe />);
    await user.click(screen.getByRole('button', { name: 'collapse the list' }));
    await user.click(screen.getByRole('button', { name: 'expand the list' }));
    expect(pane()).toBe('expanded');

    unmount();
    render(<Probe />);
    expect(pane()).toBe('expanded');

    // Explicitly `"false"`, not an erased key: the difference matters, because
    // the two are indistinguishable to the reader but not to a human debugging
    // the store.
    expect(window.localStorage.getItem(LIST_COLLAPSED_KEY)).toBe('false');
  });

  it('writes exactly the two strings the persistence shape names', async () => {
    const user = userEvent.setup();
    render(<Probe />);

    await user.click(screen.getByRole('button', { name: 'collapse the list' }));
    expect(window.localStorage.getItem(LIST_COLLAPSED_KEY)).toBe('true');

    await user.click(screen.getByRole('button', { name: 'expand the list' }));
    expect(window.localStorage.getItem(LIST_COLLAPSED_KEY)).toBe('false');
  });
});

// ── The key belongs to the hook alone ───────────────────────────────────────

describe('the key', () => {
  it('is not written merely by rendering, so an untouched preference stays untouched', () => {
    render(<Probe />);

    // Reading must not create the key. An engineer who has never collapsed the
    // list should have nothing in the store attributable to this feature, and a
    // hook that wrote its default on mount would make "absent" unobservable.
    expect(storedKeys()).toEqual([]);
  });

  it('appears in the store only as a result of using the hook', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(storedKeys()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'toggle the list' }));

    // Exactly one key, and it is this one — no companion entry, no second copy
    // of the same fact under another name.
    expect(storedKeys()).toEqual([LIST_COLLAPSED_KEY]);
  });

  it('is mentioned by exactly one file in src/, which is the hook that owns it', () => {
    // data-model.md rule 3: no pane, and nothing in `src/core`, `src/providers`
    // or `src/main`, knows this value exists. That is a claim about absence, so
    // it is asserted against the source tree rather than against a render — the
    // same technique `tests/unit/dogfood.speckit.test.ts` uses for its structural
    // claims. A second reader would be a second definition of "collapsed", and
    // the two would drift the first time one of them was changed.
    expect(sourceFilesMentioningKey()).toEqual(['src/renderer/query/usePaneState.ts']);
  });

  it('would be found elsewhere if it were there, so the scan is not vacuous', () => {
    // Guards the assertion above against passing because the walk found nothing
    // at all — a broken path or a filter that excluded every file would look
    // identical to a clean result.
    const scanned = sourceFiles();
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned).toContain('src/renderer/query/usePaneState.ts');
    expect(scanned.some((path) => path.startsWith('src/main/'))).toBe(true);
    expect(scanned.some((path) => path.startsWith('src/core/'))).toBe(true);
  });
});

// ── Source-tree walk ────────────────────────────────────────────────────────

const repoRoot = join(import.meta.dirname, '..', '..');

/** Every TypeScript source file under `src/`, as repository-relative POSIX paths. */
function sourceFiles(): string[] {
  const root = join(repoRoot, 'src');
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => relative(repoRoot, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

/** Those that contain the key's literal text anywhere — comment, string, or identifier. */
function sourceFilesMentioningKey(): string[] {
  return sourceFiles().filter((path) =>
    readFileSync(join(repoRoot, path), 'utf8').includes(LIST_COLLAPSED_KEY),
  );
}
