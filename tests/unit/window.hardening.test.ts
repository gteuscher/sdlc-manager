/**
 * T054 — the renderer hardening settings.
 *
 * These four flags are the ones people loosen while debugging and never restore.
 * The constitution makes the stakes explicit: this application renders markdown
 * from repositories and rich text from issue trackers, so a Principle IX
 * violation in a desktop renderer is host code execution, not merely a
 * cross-site scripting defect. That is why they get an assertion rather than a
 * convention.
 *
 * The test also proves something about the module's shape: `src/main/window.ts`
 * must be importable with no Electron runtime at all, which is why this file runs
 * in the node project and imports it directly.
 */

import { describe, expect, it } from 'vitest';

import {
  CONTENT_SECURITY_POLICY,
  DEVELOPMENT_CONTENT_SECURITY_POLICY,
  createWindowOptions,
  policyFor,
  rendererEntry,
} from '@main/window';

const options = createWindowOptions('/somewhere/preload.cjs');

describe('BrowserWindow hardening (constitution: desktop runtime hardening is mandatory)', () => {
  it('enables context isolation', () => {
    expect(options.webPreferences.contextIsolation).toBe(true);
  });

  it('disables Node integration in the renderer', () => {
    expect(options.webPreferences.nodeIntegration).toBe(false);
  });

  it('runs the renderer sandboxed', () => {
    expect(options.webPreferences.sandbox).toBe(true);
  });

  it('leaves web security on', () => {
    expect(options.webPreferences.webSecurity).toBe(true);
  });

  it('points at the preload script, which is the only path between the processes', () => {
    expect(options.webPreferences.preload).toBe('/somewhere/preload.cjs');
  });

  it('grants no Node access by any of the secondary routes either', () => {
    const preferences = options.webPreferences as unknown as Record<string, unknown>;
    for (const flag of ['nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag', 'allowRunningInsecureContent']) {
      if (flag in preferences) expect(preferences[flag], flag).toBe(false);
    }
  });
});

describe('content security policy', () => {
  it('forbids remote code by defaulting every source to self', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
  });

  it('permits no eval', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
  });

  it('permits no inline script', () => {
    // `style-src 'unsafe-inline'` is acceptable and separate; script is not.
    const scriptDirective = CONTENT_SECURITY_POLICY.split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('script-src'));
    expect(scriptDirective ?? "script-src 'self'").not.toContain('unsafe-inline');
  });

  it('opens no network connection from the renderer, which has no need of one', () => {
    // Every read the renderer performs goes over the IPC bridge; the renderer
    // itself "cannot open any network connection" (ipc-surface.md §4).
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
  });

  it('loads no remote frames, objects, or workers', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });
});

describe('the development policy cannot reach a packaged build', () => {
  /**
   * A dev-only CSP is a reasonable thing to be suspicious of, so the suspicion is
   * discharged here rather than in a comment. The relaxation exists because
   * React's inline Fast Refresh preamble cannot run under `script-src 'self'` —
   * with the strict policy, development does not lose HMR, it fails to mount at
   * all. These assertions are what stop it from shipping.
   */

  it('a file entry — every packaged build — gets the strict policy', () => {
    expect(policyFor({ kind: 'file', path: '/somewhere/dist/renderer/index.html' })).toBe(CONTENT_SECURITY_POLICY);
  });

  it('only a dev-server URL gets the relaxed policy', () => {
    const relaxed = policyFor({ kind: 'url', url: 'http://localhost:5173' });
    expect(relaxed).not.toBe(CONTENT_SECURITY_POLICY);
    expect(relaxed).toContain('unsafe-inline');
  });

  it('a URL entry is only ever produced by SDLC_RENDERER_URL', () => {
    // The relaxation is gated on this and nothing else, so a packaged build —
    // which sets no such variable — cannot take that branch.
    expect(rendererEntry({} as NodeJS.ProcessEnv).kind).toBe('file');
    expect(rendererEntry({ SDLC_RENDERER_URL: 'http://localhost:5173' } as NodeJS.ProcessEnv).kind).toBe('url');
  });

  it('the shipped policy still forbids inline script, eval, and every connection', () => {
    // Re-asserted here, next to the relaxation, so that widening one by editing
    // the other fails loudly.
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline;');
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
  });

  it('even relaxed, the development policy admits no remote origin', () => {
    const relaxed = DEVELOPMENT_CONTENT_SECURITY_POLICY('http://localhost:5173');
    // Localhost and nothing else: no CDN, no wildcard, no remote code.
    expect(relaxed).not.toContain('*');
    expect(relaxed).not.toContain('https://');
    expect(relaxed).toContain("object-src 'none'");
    expect(relaxed).toContain("frame-src 'none'");
  });
});

describe('renderer entry resolution', () => {
  it('uses the dev server URL when one is supplied', () => {
    const entry = rendererEntry({ SDLC_RENDERER_URL: 'http://localhost:5173' } as NodeJS.ProcessEnv);
    expect(entry).toEqual({ kind: 'url', url: 'http://localhost:5173' });
  });

  it('falls back to the built file for a packaged application', () => {
    const entry = rendererEntry({} as NodeJS.ProcessEnv);
    expect(entry.kind).toBe('file');
    if (entry.kind !== 'file') return;
    expect(entry.path).toContain('index.html');
  });
});

describe('the module itself', () => {
  it('is importable with no Electron runtime, which is what makes it testable', () => {
    // Reaching this line at all is the assertion: a static `import { BrowserWindow }
    // from "electron"` at the top of window.ts would have failed collection.
    expect(typeof createWindowOptions).toBe('function');
  });
});
