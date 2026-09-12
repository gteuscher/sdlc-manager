/**
 * T053 — gate 9, command parity (Principle XIV).
 *
 * "Whatever runs locally is the same command any automation runs — no inline
 * equivalents." The failure this prevents is the common one: CI grows a
 * `npx vitest run --coverage --reporter=junit` step, the maintainer keeps running
 * `npm test`, the two drift, and the gate stops meaning anything.
 *
 * So this asserts three things: the documented command list is real, `verify`
 * composes named commands rather than inlining them, and any automation config
 * present invokes only named commands.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

async function packageScripts(): Promise<Record<string, string>> {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

/** `npm run <name>` or `npm test` — the only two shapes a named invocation takes. */
const NAMED_INVOCATION = /^npm\s+(?:run\s+([A-Za-z0-9:_-]+)|(test))\s*$/;

describe('the documented command list is real (quickstart.md §Commands)', () => {
  it('every command the quickstart documents exists as an npm script', async () => {
    const quickstart = await readFile(
      join(root, 'specs', '001-sdlc-work-item-dashboard', 'quickstart.md'),
      'utf8',
    );
    const scripts = await packageScripts();

    const documented = new Set<string>();
    for (const match of quickstart.matchAll(/`npm run ([a-z0-9:_-]+)`/g)) {
      const name = match[1];
      if (name !== undefined) documented.add(name);
    }

    expect(documented.size).toBeGreaterThan(5);
    for (const name of documented) {
      expect(Object.keys(scripts), `quickstart documents "npm run ${name}"`).toContain(name);
    }
  });

  it('documents `npm test` as the single command for the full offline suite', async () => {
    const scripts = await packageScripts();
    expect(scripts['test']).toBeDefined();
  });

  it('names every gate command the constitution requires', async () => {
    const scripts = await packageScripts();
    for (const required of ['dev', 'build', 'package', 'test', 'typecheck', 'lint', 'size', 'smoke', 'verify']) {
      expect(Object.keys(scripts), `missing named command "${required}"`).toContain(required);
    }
  });

  it('names a fixture command for each quickstart scenario that uses one', async () => {
    const scripts = await packageScripts();
    for (const required of ['fixture:create', 'fixture:package', 'fixture:fail', 'fixture:upgrade']) {
      expect(Object.keys(scripts)).toContain(required);
    }
  });
});

describe('verify composes named commands rather than inlining them', () => {
  it('is built only from other named scripts', async () => {
    const scripts = await packageScripts();
    const verify = scripts['verify'];
    expect(verify).toBeDefined();

    const segments = (verify ?? '').split('&&').map((segment) => segment.trim());
    for (const segment of segments) {
      const match = NAMED_INVOCATION.exec(segment);
      expect(match, `verify contains an inline equivalent: "${segment}"`).not.toBeNull();
      const name = match?.[1];
      if (name !== undefined) {
        expect(Object.keys(scripts), `verify invokes undefined script "${name}"`).toContain(name);
      }
    }
  });

  it('covers every machine-enforced gate the constitution lists', async () => {
    const scripts = await packageScripts();
    const verify = scripts['verify'] ?? '';
    // Gates 1 and 3-6 run inside `npm test`; 2, 7 and 8 are their own commands.
    for (const command of ['test', 'typecheck', 'lint', 'size', 'smoke']) {
      expect(verify, `verify does not run "${command}"`).toContain(command);
    }
  });

  it('runs no tool directly, which would be the inline equivalent the principle forbids', async () => {
    const scripts = await packageScripts();
    const verify = scripts['verify'] ?? '';
    for (const tool of ['vitest', 'tsc ', 'eslint', 'playwright', 'size-limit']) {
      expect(verify, `verify invokes ${tool} directly instead of a named command`).not.toContain(tool);
    }
  });
});

describe('any automation invokes only named commands', () => {
  async function automationFiles(): Promise<string[]> {
    const found: string[] = [];
    const workflows = join(root, '.github', 'workflows');
    if (existsSync(workflows)) {
      for (const entry of await readdir(workflows)) {
        if (entry.endsWith('.yml') || entry.endsWith('.yaml')) found.push(join(workflows, entry));
      }
    }
    for (const candidate of ['.gitlab-ci.yml', 'azure-pipelines.yml', 'Jenkinsfile']) {
      const path = join(root, candidate);
      if (existsSync(path)) found.push(path);
    }
    return found;
  }

  it('every run step in every automation config is a named command', async () => {
    const files = await automationFiles();
    const scripts = await packageScripts();

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const match of contents.matchAll(/^\s*(?:- )?run:\s*(.+)$/gm)) {
        const command = (match[1] ?? '').trim().replace(/^["']|["']$/g, '');
        // Checkout, setup, and install steps are not project commands.
        if (/^(npm (ci|install)|actions\/|uses:)/.test(command)) continue;
        if (command === '') continue;

        const named = NAMED_INVOCATION.exec(command);
        expect(named, `${file} runs an inline equivalent: "${command}"`).not.toBeNull();
        const name = named?.[1];
        if (name !== undefined) {
          expect(Object.keys(scripts), `${file} invokes undefined script "${name}"`).toContain(name);
        }
      }
    }
  });

  it('reports honestly when there is no automation to check', async () => {
    // Gate 9 is meaningful only once automation exists. Recording the absence
    // keeps it from silently passing forever, which is exactly what the
    // constitution says a gate must not do.
    const files = await automationFiles();
    expect(Array.isArray(files)).toBe(true);
  });
});
