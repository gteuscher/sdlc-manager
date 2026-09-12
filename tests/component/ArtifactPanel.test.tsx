/**
 * T086 — the artifacts behind a state: all three kinds, the artifact that cannot
 * be read, and the artifact that is too large to render on open.
 *
 * Story 3's independent test is exactly this list — "configure a state with one
 * markdown artifact, one issue-tracker artifact, and one test-result artifact,
 * then confirm all three render with correct provenance and reconciliation time,
 * and that an unreadable artifact reports the failure rather than rendering
 * blank" — so this file follows it literally.
 *
 * The markdown case is rendered through the real `React.lazy` boundary rather
 * than a stand-in, because the lazy import is load-bearing (Principle XII) and a
 * test that bypassed it would not prove the `Suspense` path works at all.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lazy } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { axe } from 'vitest-axe';
import 'vitest-axe/extend-expect';

import type { ArtifactContent, ArtifactRef } from '@core/model/observed';

import { ArtifactPanel, LARGE_ARTIFACT_BYTES } from '@renderer/components/ArtifactPanel';
import { createBridgeStub, installBridge, type BridgeStub } from '../support/bridge';

const RECONCILED = '2026-09-11T08:30:00.000Z';

const MarkdownView = lazy(() => import('@renderer/components/MarkdownArtifact'));

function ref(overrides: Partial<ArtifactRef> & { id: string; name: string }): ArtifactRef {
  return { kind: 'markdown', provider: 'ledger', required: false, ...overrides };
}

function content(overrides: Partial<ArtifactContent> & { artifactId: string }): ArtifactContent {
  return {
    kind: 'markdown',
    provider: 'ledger',
    locator: 'docs/weave-notes.md',
    content: '# Weave notes',
    reconciledAt: RECONCILED,
    truncated: false,
    byteLength: 13,
    ...overrides,
  };
}

let teardown: (() => void) | undefined;

function mount(stub: BridgeStub, artifact: ArtifactRef): { container: HTMLElement } {
  teardown = installBridge(stub);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      {/* The headings an artifact actually sits under in the detail route. They
          are here so the accessibility assertions below judge the component in
          its real document outline rather than flagging an h4 that begins a
          document only because the test rendered it alone. */}
      <h1>Reconcile the ledger</h1>
      <h2>Weaving</h2>
      <h3>Artifacts</h3>
      <ArtifactPanel
        itemKey="LED-42"
        stateId="weaving"
        artifact={artifact}
        markdownView={MarkdownView}
      />
    </QueryClientProvider>,
  );
  return { container };
}

function reading(value: ArtifactContent): BridgeStub {
  return createBridgeStub({ getArtifact: () => Promise.resolve({ ok: true as const, value }) });
}

beforeEach(() => {
  teardown = undefined;
});

afterEach(() => {
  teardown?.();
});

describe('one artifact', () => {
  it('renders a markdown document with its source path and last-reconciled time', async () => {
    mount(
      reading(
        content({
          artifactId: 'weave-notes',
          content: '# Weave notes\n\nThe warp is set across all eight passes.',
        }),
      ),
      ref({ id: 'weave-notes', name: 'Weave notes' }),
    );

    // Rendered to React elements through the lazy chunk (Story 3 acceptance 1).
    expect(await screen.findByText(/the warp is set across all eight passes/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Weave notes', level: 1 })).toBeDefined();

    // FR-018: provenance and reconciliation time, on the artifact itself.
    expect(screen.getByText('docs/weave-notes.md')).toBeDefined();
    expect(screen.getByText('Last reconciled')).toBeDefined();
    expect(screen.getByText('ledger')).toBeDefined();
  });

  it('renders issue-tracker content as inert text, attributed to the provider it came from', async () => {
    mount(
      reading(
        content({
          artifactId: 'card',
          kind: 'tracker',
          provider: 'ledger-board',
          locator: 'LED-42',
          content: 'Owner: R. Hale\n\nThe card was reopened after the dye lot changed.',
        }),
      ),
      ref({ id: 'card', name: 'Ledger card', kind: 'tracker', provider: 'ledger-board' }),
    );

    // Story 3 acceptance 2: it renders, attributed.
    expect(await screen.findByText(/the card was reopened after the dye lot changed/i)).toBeDefined();
    expect(screen.getByText(/reproduced as text from ledger-board/i)).toBeDefined();
    expect(screen.getByText(/does not write to it/i)).toBeDefined();
  });

  it('renders a test run with passing distinguishable from failing', async () => {
    mount(
      reading(
        content({
          artifactId: 'run',
          kind: 'test-results',
          provider: 'ledger-runner',
          locator: 'runs/latest.json',
          content: JSON.stringify({
            outcome: 'failed',
            total: 12,
            passed: 9,
            failed: 2,
            skipped: 1,
            cases: [
              { name: 'holds tension under load', status: 'failed', detail: 'drifted by 0.4' },
              { name: 'records the dye lot', status: 'passed' },
            ],
            truncated: false,
          }),
        }),
      ),
      ref({ id: 'run', name: 'Weave test run', kind: 'test-results', provider: 'ledger-runner' }),
    );

    // Story 3 acceptance 3: enough detail to tell passing from failing.
    expect(await screen.findByText('Tests failed')).toBeDefined();
    expect(screen.getByText('holds tension under load')).toBeDefined();
    expect(screen.getByText(/drifted by 0.4/)).toBeDefined();
    expect(screen.getByText('9')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
  });

  it('reports a malformed test run as a rendered failure rather than crashing the tab', async () => {
    mount(
      reading(
        content({
          artifactId: 'run',
          kind: 'test-results',
          content: 'this is not JSON at all',
        }),
      ),
      ref({ id: 'run', name: 'Weave test run', kind: 'test-results' }),
    );

    // Principle IX: producer output is untrusted, so a bad body is a rendered
    // failure naming the reason, with what was actually received shown as text.
    expect(await screen.findByText(/not valid json/i)).toBeDefined();
    expect(screen.getByText('this is not JSON at all')).toBeDefined();
    // The provenance header is still there, so the slot is still identifiable.
    expect(screen.getByRole('heading', { name: 'Weave test run' })).toBeDefined();
  });

  it('reports a missing artifact in place, naming what failed, with a retry', async () => {
    let attempts = 0;
    mount(
      createBridgeStub({
        getArtifact: () => {
          attempts += 1;
          if (attempts === 1) {
            return Promise.resolve({
              ok: false as const,
              reason: 'not_found' as const,
              message: 'docs/weave-notes.md is declared by this state but is not in the repository.',
            });
          }
          return Promise.resolve({
            ok: true as const,
            value: content({ artifactId: 'weave-notes', content: 'Restored.' }),
          });
        },
      }),
      ref({ id: 'weave-notes', name: 'Weave notes', required: true }),
    );

    // FR-019: what is missing and why, in place, naming the declared artifact.
    expect(await screen.findByText(/is declared by this state but is not in the repository/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Weave notes' })).toBeDefined();
    expect(screen.getByText('Required and unavailable')).toBeDefined();
    expect(screen.getByText(/marks it as required for this state/i)).toBeDefined();

    // Principle X: no error state without a retry path.
    await userEvent.click(screen.getByRole('button', { name: /try reading it again — weave notes/i }));
    expect(await screen.findByText('Restored.')).toBeDefined();
  });

  it('holds a very large artifact closed, saying how big it is, rather than rendering it on open', async () => {
    const big = 'The warp is set. '.repeat(6000);
    mount(
      reading(
        content({
          artifactId: 'weave-notes',
          content: big,
          truncated: true,
          byteLength: LARGE_ARTIFACT_BYTES * 40,
        }),
      ),
      ref({ id: 'weave-notes', name: 'Weave notes' }),
    );

    // FR-021: the provenance and the size render immediately; the document does
    // not, so opening the state stays quick however long the document is.
    expect(await screen.findByText(/was truncated when it was read/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Weave notes', level: 4 })).toBeDefined();
    expect(screen.queryByText(/the warp is set/i)).toBeNull();

    const disclose = screen.getByRole('button', { name: /show this artifact — weave notes/i });
    expect(disclose.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(disclose);
    expect(await screen.findByText(/the warp is set/i)).toBeDefined();
    expect(
      screen.getByRole('button', { name: /hide this artifact — weave notes/i }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('distinguishes an artifact that is empty from one that could not be read', async () => {
    mount(
      reading(content({ artifactId: 'weave-notes', content: '   ', byteLength: 3 })),
      ref({ id: 'weave-notes', name: 'Weave notes' }),
    );

    // Principle X's deliberate nothing: "read, and empty" is a different fact
    // from "could not be read", and the two must not look alike.
    expect(await screen.findByText(/read successfully and is empty/i)).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has no detectable accessibility violations, rendered or failed', async () => {
    const rendered = mount(
      reading(content({ artifactId: 'weave-notes', content: '# Weave notes\n\n- warp\n- weft' })),
      ref({ id: 'weave-notes', name: 'Weave notes' }),
    );
    await screen.findByText('warp');
    expect(await axe(rendered.container)).toHaveNoViolations();
    teardown?.();

    const failed = mount(
      createBridgeStub({
        getArtifact: () =>
          Promise.resolve({
            ok: false as const,
            reason: 'unauthenticated' as const,
            message: 'The credential for this source was rejected.',
          }),
      }),
      ref({ id: 'card', name: 'Ledger card', kind: 'tracker', provider: 'ledger-board' }),
    );
    await screen.findByText(/the credential for this source was rejected/i);
    expect(await axe(failed.container)).toHaveNoViolations();
  });
});
