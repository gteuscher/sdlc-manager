/**
 * `npm run smoke` — gate 8, the cold-start check.
 *
 * Runs the Playwright smoke spec in tests/smoke. Kept as a named command so that
 * automation invokes the same thing the maintainer does (Principle XIV, gate 9).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

// Gate 8 is a *clean install, build and launch*. Building here rather than
// assuming a build keeps `npm run smoke` meaningful on its own, and it invokes
// the named build command rather than an inline equivalent (Principle XIV).
if (!existsSync(fileURLToPath(new URL('../dist/main.cjs', import.meta.url)))) {
  const built = await run(npm, ['run', 'build']);
  if (built !== 0) process.exit(built);
}

process.exit(await run(npx, ['playwright', 'test', '--config', 'playwright.config.ts']));
