/**
 * T043 — the BrowserWindow, and the hardening that is the point of it.
 *
 * The constitution's desktop constraint is not a preference: "renderer processes
 * MUST run with context isolation enabled and direct Node/system API access
 * disabled, MUST NOT load remote code". This application renders markdown from
 * repositories and rich text from issue trackers, so a Principle IX failure in
 * this renderer is host code execution, not a cross-site scripting defect.
 * ipc-surface.md §4 states the same thing from the renderer's side: it cannot
 * read or write any file, open any network connection, spawn any process, or
 * reach any Node or Electron API outside the bridge.
 *
 * Every flag below is one people loosen while debugging and then forget to
 * restore, which is why each is set explicitly rather than left to a default,
 * and why a test asserts each by name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO TOP-LEVEL `electron` IMPORT.
 *
 * `createWindowOptions`, `CONTENT_SECURITY_POLICY`, and `rendererEntry` are the
 * hardening decisions, and they must be assertable in a plain node unit test
 * with no Electron runtime present. So the only top-level reference to Electron
 * is an erased `import type`, and the runtime module is loaded with a dynamic
 * import inside `createMainWindow` — the one function that genuinely needs a
 * running Electron.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserWindow as ElectronBrowserWindow } from 'electron';

/**
 * The renderer's content policy. Forbids remote code outright.
 *
 *   default-src 'self'   nothing loads from anywhere but the app itself
 *   script-src  'self'   no remote script, and NO 'unsafe-eval' — an eval'd
 *                        string is remote code once any provider content
 *                        reaches it
 *   connect-src 'none'   the renderer opens no network connection of its own.
 *                        Every provider call is made by the main process and
 *                        crosses the bridge as validated data (ipc-surface.md §4)
 *   object-src / frame-src 'none', base-uri / form-action 'none'
 *                        no plugin, no frame, no <base> rewrite, no form post
 *
 * `style-src` allows inline style because the renderer's component primitives
 * set inline style attributes; inline CSS cannot execute, so it does not weaken
 * the "no remote code" guarantee. `img-src` and `font-src` allow `data:` for
 * bundled assets, which are equally inert.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * The policy used **only** when the renderer is served by the development server.
 *
 * This exists because the strict policy above makes development impossible rather
 * than merely inconvenient. React's Fast Refresh preamble is an *inline* module
 * script, so `script-src 'self'` blocks it, the plugin reports "can't detect
 * preamble", and the application never mounts at all — the window sits on the
 * `index.html` fallback text. The dev server's HMR socket is likewise blocked by
 * `connect-src 'none'`.
 *
 * The obvious worry about a dev-only policy is that it ships. Three things stop
 * that here, and they are structural rather than a promise:
 *
 *   1. It is selected only when `rendererEntry` resolves to a **url**, which
 *      happens only when `SDLC_RENDERER_URL` is set. A packaged build loads from
 *      `file://` and can never take this branch.
 *   2. It is a separate constant. `CONTENT_SECURITY_POLICY` — the one the
 *      hardening test asserts against, and the one a packaged build uses — is
 *      untouched and still forbids inline script and every network connection.
 *   3. `policyFor()` below is the single selection point, and it is asserted in
 *      both directions by `tests/unit/window.hardening.test.ts`.
 *
 * It stays as tight as it can be while working: inline script and the dev
 * server's own origin, and nothing else. Remote code is still refused.
 */
export const DEVELOPMENT_CONTENT_SECURITY_POLICY = (origin: string): string =>
  [
    `default-src 'self' ${origin}`,
    // React Fast Refresh injects an inline preamble; `eval` is what the dev
    // server's module runner needs. Neither is permitted in the shipped policy.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `img-src 'self' data: ${origin}`,
    `font-src 'self' data: ${origin}`,
    // The HMR websocket, and nothing beyond the dev server itself.
    `connect-src 'self' ${origin} ws://${origin.replace(/^https?:\/\//, '')}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

/**
 * Chooses the policy for a renderer entry. The only place the choice is made.
 *
 * A `file` entry — every packaged build — always gets the strict policy.
 */
export function policyFor(entry: RendererEntry): string {
  return entry.kind === 'url' ? DEVELOPMENT_CONTENT_SECURITY_POLICY(entry.url) : CONTENT_SECURITY_POLICY;
}

/**
 * A plain, serialisable mirror of the BrowserWindow options this app uses. Plain
 * so that the hardening can be asserted as data, without constructing a window.
 * The literal `true`/`false` types mean a loosened flag fails the typecheck as
 * well as the test.
 */
export interface WindowWebPreferences {
  /** Absolute path to the compiled preload script — the renderer's only bridge. */
  readonly preload: string;
  readonly contextIsolation: true;
  readonly nodeIntegration: false;
  readonly sandbox: true;
  readonly webSecurity: true;
  readonly nodeIntegrationInWorker: false;
  readonly nodeIntegrationInSubFrames: false;
  readonly webviewTag: false;
  readonly allowRunningInsecureContent: false;
  readonly experimentalFeatures: false;
}

export interface WindowOptions {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  /** Shown on `ready-to-show`, so the first frame is never a blank window (Principle X). */
  readonly show: false;
  readonly backgroundColor: string;
  readonly autoHideMenuBar: true;
  readonly webPreferences: WindowWebPreferences;
}

export function createWindowOptions(preloadPath: string): WindowOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: '#101114',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      // ── The four the constitution names, and a test asserts by name ────────
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // ── The ones that reopen the same hole by another door ─────────────────
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  };
}

export type RendererEntry = { readonly kind: 'url'; readonly url: string } | { readonly kind: 'file'; readonly path: string };

/** Variable `npm run dev` sets to point the window at the Vite dev server. */
const RENDERER_URL_ENV_VAR = 'SDLC_RENDERER_URL';

/**
 * Where the built renderer sits, resolved from this module rather than from the
 * working directory, which a packaged launch does not control.
 *
 * Two shapes, because this module is read in two: bundled to `dist/main.cjs`,
 * where the directory *is* `dist`; and as source at `src/main/window.ts`, where
 * `dist` is two levels up.
 */
function rendererIndexPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDirectory = path.basename(here) === 'dist' ? here : path.resolve(here, '..', '..', 'dist');
  return path.join(distDirectory, 'renderer', 'index.html');
}

export function rendererEntry(env?: NodeJS.ProcessEnv): RendererEntry {
  const devServer = (env ?? process.env)[RENDERER_URL_ENV_VAR];
  if (devServer !== undefined && devServer.trim() !== '') {
    return { kind: 'url', url: devServer.trim() };
  }
  return { kind: 'file', path: rendererIndexPath() };
}

/** Whether a navigation target is the app's own renderer rather than somewhere else. */
function isOwnRenderer(target: string, entry: RendererEntry): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') return true;
  if (entry.kind !== 'url') return false;
  try {
    return url.origin === new URL(entry.url).origin;
  } catch {
    return false;
  }
}

/**
 * Creates the application window with every hardening applied before anything is
 * loaded. Returns the `BrowserWindow`, typed `unknown` at the module boundary so
 * that importing this file never pulls in Electron's types at runtime.
 */
export async function createMainWindow(preloadPath: string, env?: NodeJS.ProcessEnv): Promise<unknown> {
  // The dynamic import is the whole reason this module stays testable without an
  // Electron runtime. Do not hoist it.
  const { BrowserWindow, session } = await import('electron');
  const entry = rendererEntry(env);
  const defaultSession = session.defaultSession;

  // ── CSP as a response header ────────────────────────────────────────────────
  // A packaged build loads from `file://` and always gets the strict policy. Only
  // a renderer served from a dev-server URL gets the relaxed one, because React's
  // inline Fast Refresh preamble cannot run under `script-src 'self'` — with the
  // strict policy in development the application does not merely lose HMR, it
  // never mounts. `policyFor` is the single place that choice is made, and it is
  // asserted in both directions.
  const policy = policyFor(entry);
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });

  // ── Every permission request is denied ──────────────────────────────────────
  // A dashboard that reads files and trackers needs no camera, microphone,
  // geolocation, clipboard read, or notification. There is no allowlist to widen
  // later: a capability the renderer needs arrives as a bridge method with its
  // own validation (ipc-surface.md §4), never as a granted browser permission.
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.setDevicePermissionHandler(() => false);

  const window: ElectronBrowserWindow = new BrowserWindow(createWindowOptions(preloadPath));

  // ── Navigation is pinned to the app's own renderer ──────────────────────────
  // Remote code loaded by navigating away would bypass the CSP entirely. A link
  // to elsewhere is refused rather than opened: the renderer has no outbound
  // network capability, and handing one to the OS browser on a provider-supplied
  // href would give untrusted content a way out.
  window.webContents.on('will-navigate', (event, target) => {
    if (!isOwnRenderer(target, entry)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, target) => {
    if (!isOwnRenderer(target, entry)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Nothing in this application attaches a webview; if something ever does, it
  // does not inherit a weaker preload than the window itself.
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  // ── A failed load must say so ───────────────────────────────────────────────
  // Principle V: an error surfaced to the user names what failed and what they
  // can do next. Without this, every renderer failure — a dev server that is not
  // up yet, a missing build, a CSP that blocks the entry script — presents
  // identically as a window showing the fallback markup in `index.html`, with
  // nothing anywhere saying why. That ambiguity cost this project several hours.
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl) => {
    // `-3` is ERR_ABORTED, which a normal in-app navigation produces.
    if (errorCode === -3) return;
    process.stderr.write(
      `\nThe renderer failed to load ${failedUrl || describeEntry(entry)}: ${errorDescription} (${errorCode}).\n` +
        (entry.kind === 'url'
          ? `The dev server at ${entry.url} did not answer. Is it still starting, or did a previous "npm run dev" leave one running?\n`
          : `Expected the built renderer at ${entry.path}. Run "npm run build".\n`),
    );
  });

  await loadRenderer(window, entry);

  return window;
}

function describeEntry(entry: RendererEntry): string {
  return entry.kind === 'url' ? entry.url : entry.path;
}

/**
 * Loads the renderer, retrying a development URL a few times.
 *
 * A packaged build loads a file and is not retried: if that fails the
 * installation is broken and another attempt will not help. A dev server, by
 * contrast, restarts whenever its config changes, and a window that died
 * permanently the first time it was a moment early is the failure this project
 * hit repeatedly.
 */
async function loadRenderer(window: ElectronBrowserWindow, entry: RendererEntry): Promise<void> {
  if (entry.kind === 'file') {
    await window.loadFile(entry.path);
    return;
  }

  const attempts = 10;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await window.loadURL(entry.url);
      return;
    } catch (error) {
      if (attempt === attempts) {
        process.stderr.write(
          `\nGave up loading the renderer from ${entry.url} after ${attempts} attempts: ` +
            `${error instanceof Error ? error.message : String(error)}\n`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
