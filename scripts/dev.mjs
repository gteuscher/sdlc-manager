/**
 * `npm run dev` — the single documented start command (Principle I, Principle XIV).
 *
 * Runs four processes: a Vite dev server for the renderer, watching builds for the
 * main process and the preload, and Electron pointed at all of them. There is no
 * `electron-vite` dependency here on purpose — the dependency ledger in
 * research.md §17 does not include one, and this orchestration is short.
 *
 * Two things here are less obvious than they look, and both were bugs first:
 *
 *   **No `shell: true`.** On Windows that wraps each child in a `cmd.exe`, and
 *   `child.kill()` then kills only the wrapper — the real Vite process survives,
 *   keeps port 5173, and npm never returns, so the terminal that launched the app
 *   hangs after the window closes. Running the real executables instead of the
 *   `npx` shims avoids the wrapper entirely (and silences Node's DEP0190 warning
 *   about unescaped shell arguments).
 *
 *   **Shutdown kills the tree.** A child may still spawn grandchildren.
 *   `taskkill /T` on Windows, and a process-group signal elsewhere, are what
 *   actually stop them.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const isWindows = process.platform === 'win32';
const require = createRequire(import.meta.url);

/**
 * Real executables, not the `npx` shims.
 *
 * Node refuses to spawn a `.cmd` without `shell: true` (the CVE-2024-27980 fix),
 * and `shell: true` is exactly what breaks shutdown on Windows — see the header.
 * So Vite is run as a script through this same Node, and Electron through the
 * binary path its package exports.
 */
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
/** The `electron` package exports the path to its binary when required from Node. */
const electronBin = require('electron');

const node = (args, extraEnv) => run(process.execPath, args, extraEnv);

const children = [];
let shuttingDown = false;
let electronStarted = false;

function run(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    // Deliberately not `shell: true` — see the header.
    shell: false,
    // Its own process group, so a signal reaches the whole tree on POSIX.
    detached: !isWindows,
    env: { ...process.env, ...extraEnv },
  });
  children.push(child);
  return child;
}

function killTree(child) {
  if (child.pid === undefined || child.killed) return;
  try {
    if (isWindows) {
      // /T kills the whole tree, which is where the real vite process lives.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // Already gone. Nothing to do.
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  // Give taskkill a moment to land before the parent exits, so nothing is
  // orphaned holding the port.
  setTimeout(() => process.exit(code ?? 0), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) killTree(child);
});

const PORT = 5173;
const RENDERER_URL = `http://localhost:${PORT}`;

const renderer = node([viteBin, '--port', String(PORT), '--strictPort']);
node([viteBin, 'build', '--config', 'electron.vite.config.ts', '--watch']);
node([viteBin, 'build', '--config', 'preload.vite.config.ts', '--watch']);

/**
 * If the dev server dies before Electron is up — almost always because a previous
 * `npm run dev` is still holding the port — abort loudly.
 *
 * Launching anyway is worse than failing: Electron would connect to the *older*
 * server and show a window built from whatever environment that one was started
 * with, so the symptom is a correct-looking app ignoring your configuration.
 */
renderer.on('exit', (code) => {
  if (electronStarted || shuttingDown || code === 0) return;
  console.error(
    `\nThe renderer dev server exited (code ${code}) before the app started.\n` +
      `If it reported "Port ${PORT} is already in use", a previous "npm run dev" is still running.\n` +
      `Find it with:  Get-NetTCPConnection -LocalPort ${PORT} -State Listen\n`,
  );
  shutdown(1);
});

const mainEntry = fileURLToPath(new URL('../dist/main.cjs', import.meta.url));
const preloadEntry = fileURLToPath(new URL('../dist/preload.cjs', import.meta.url));

/** Resolves once the dev server answers, or rejects after `timeoutMs`. */
async function waitForRenderer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    try {
      const response = await fetch(RENDERER_URL, { method: 'GET' });
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function waitForBuilds(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    if (existsSync(mainEntry) && existsSync(preloadEntry)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Wait for **both** the builds and the dev server before starting Electron.
 *
 * Waiting only for the build artifacts is not enough, and the failure is
 * confusing rather than obvious: on a tree that has been built before, both files
 * already exist, so Electron starts immediately, asks for the dev server before
 * Vite is listening, gets a failed load — and simply stays on the fallback markup
 * in `index.html` forever, because nothing retries. The window looks like a
 * broken application rather than a mistimed one.
 */
async function start() {
  if (!(await waitForBuilds(60_000))) {
    if (shuttingDown) return;
    console.error('Main and preload builds did not produce dist/main.cjs and dist/preload.cjs within 60s.');
    shutdown(1);
    return;
  }

  if (!(await waitForRenderer(60_000))) {
    if (shuttingDown) return;
    console.error(`\nThe renderer dev server at ${RENDERER_URL} did not start within 60s.\n`);
    shutdown(1);
    return;
  }

  electronStarted = true;
  const electron = run(electronBin, ['.'], { SDLC_RENDERER_URL: RENDERER_URL });
  // Closing the window ends the session: everything else here exists to serve it.
  electron.on('exit', (code) => shutdown(code ?? 0));
}

void start();
