/**
 * The Electron main entry (`dist/main.cjs`).
 *
 * One call, and nothing else. The entry script *is* the side effect — Electron
 * starts a process and runs this file — which is why lint permits a top-level
 * call here and in `src/preload/index.ts`, and nowhere else in `src/`
 * (Principle VIII). Everything the process is made of is constructed by
 * `bootstrap()` in `./index.js`, which keeps the composition root itself
 * importable, and therefore testable, without an Electron runtime.
 */

import { bootstrap } from './index.js';

bootstrap().catch((error: unknown) => {
  // The last line of defence. A rejection here means the window never opened, so
  // there is nothing left to render the failure in; it goes to stderr and the
  // process exits non-zero rather than hanging with no interface.
  process.stderr.write(
    `The application failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
