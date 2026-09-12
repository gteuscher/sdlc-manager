/**
 * T094, T095 — one artifact: its provenance, its content, or an honest account
 * of why neither is available.
 *
 * Two requirements shape everything here.
 *
 * **FR-019 — a failure is reported in place.** A declared artifact that is
 * missing, unreadable, or unauthorised must say what failed and why, *and the
 * rest of the state must still render*. So each artifact reads independently,
 * renders its own outcome, and cannot take a sibling down: one deleted markdown
 * file blanks one slot, never the tab. The failure carries a retry, because
 * Principle X admits no error state without one, and because the usual cause —
 * a provider that was briefly unreachable — is exactly what a retry clears. The
 * artifact's declared name and kind stay on screen through the failure: an
 * engineer needs to know *which* declared artifact is missing, and that is
 * knowledge from the manifest, which is still available.
 *
 * **FR-021 — a very large artifact must not block the rest of the view.** Three
 * mechanisms, because one is not enough:
 *
 *   - The main process truncates before sending, and says so through
 *     `truncated` and `byteLength`. That is reported rather than hidden: an
 *     engineer reading a partial document must know it is partial.
 *   - A large document is **not parsed until it is asked for**. The provenance,
 *     the size, and a disclosure button render immediately; the body is built
 *     when the engineer opens it. A five-megabyte specification therefore costs
 *     nothing until it is wanted, which is what "does not block the rest of the
 *     view" means in a synchronous renderer.
 *   - The markdown parser arrives through `React.lazy` behind a `Suspense`
 *     boundary scoped to this artifact, so the gates, the provenance, and every
 *     sibling artifact have already painted before it resolves.
 *
 * **The markdown view is a prop, not an import.** `routes/ItemDetail.tsx` owns
 * the `React.lazy` boundary because the route is what the bundle budget is
 * measured against (Principle XII, T090). Passing the component down keeps that
 * boundary in one place, keeps this file free of `react-markdown`, and makes the
 * dependency explicit in the signature rather than hidden in an import
 * (Principle VIII).
 *
 * **On dispatching by kind.** `markdown` and `test-results` get views that
 * understand their shape. Every other declared kind — including tracker content,
 * and including a kind a future manifest introduces — falls through to the inert
 * text view. That is deliberate: an unknown kind renders as what it provably is,
 * untrusted text with its provenance attached, rather than being guessed at or
 * dropped (Principle II, FR-017).
 */

import { Suspense, useEffect, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

import type { ArtifactRef } from '@core/model/observed';

import { ArtifactProvenance } from './ArtifactProvenance';
import { TestResultsArtifact } from './TestResultsArtifact';
import { TrackerArtifact } from './TrackerArtifact';
import { REQUEST_CEILING_MS } from '../query/client';
import { useArtifact } from '../query/hooks';

/** The two kinds with a view of their own. Application contract, not lifecycle vocabulary. */
const KIND_MARKDOWN = 'markdown';
const KIND_TEST_RESULTS = 'test-results';

/** Above this, content is disclosed on request rather than rendered on open (FR-021). */
export const LARGE_ARTIFACT_BYTES = 40_000;

export interface ArtifactPanelProps {
  readonly itemKey: string;
  readonly stateId: string;
  /** What the manifest declares. Available even when the content is not. */
  readonly artifact: ArtifactRef;
  /**
   * The markdown view, supplied by the route that owns its lazy chunk. Kept out
   * of this module so `react-markdown` cannot reach the initial bundle.
   */
  readonly markdownView: ComponentType<{ readonly content: string }>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactPanel({
  itemKey,
  stateId,
  artifact,
  markdownView: MarkdownView,
}: ArtifactPanelProps): ReactElement {
  const query = useArtifact(itemKey, stateId, artifact.id);
  const [opened, setOpened] = useState(false);

  const headingId = `artifact-${stateId}-${artifact.id}`;

  // ── Principle X: no wait without a ceiling ────────────────────────────────
  // Reading an artifact is provider-bound — a file on disk, a ticket over the
  // network — so ten seconds is the constitution's default ceiling, after which
  // the wait becomes a rendered failure with a retry rather than a spinner.
  const pending = query.isPending;
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), REQUEST_CEILING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pending]);

  function failure(problem: string, hint: string): ReactElement {
    return (
      <article className="artifact artifact--failed" aria-labelledby={headingId}>
        <header className="artifact__head">
          <h4 className="artifact__name" id={headingId}>
            {artifact.name}
          </h4>
          <p className="artifact__provenance">
            <span className="artifact__fact">
              <span className="artifact__fact-label">Kind</span>
              <span className="artifact__fact-value">{artifact.kind}</span>
            </span>
            <span className="artifact__fact">
              <span className="artifact__fact-label">Declared source</span>
              <span className="artifact__fact-value">{artifact.provider}</span>
            </span>
            <span className="artifact__fact">
              <span className="tag tag--missing">
                {artifact.required ? 'Required and unavailable' : 'Unavailable'}
              </span>
            </span>
          </p>
        </header>
        <p className="artifact__problem" role="alert">
          {problem}
        </p>
        <p className="artifact__hint">{hint}</p>
        <button
          className="button button--small"
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? 'Retrying…' : 'Try reading it again'}
          {/* A state can declare several artifacts, so every retry button on the
              tab would otherwise be named identically. */}
          <span className="sr-only"> — {artifact.name}</span>
        </button>
      </article>
    );
  }

  if (pending && !timedOut) {
    return (
      <article className="artifact artifact--pending" aria-labelledby={headingId}>
        <header className="artifact__head">
          <h4 className="artifact__name" id={headingId}>
            {artifact.name}
          </h4>
        </header>
        <p className="pending" role="status">
          Reading this artifact from {artifact.provider}&hellip;
        </p>
      </article>
    );
  }

  if (pending) {
    return failure(
      `${artifact.provider} has not answered for this artifact within ten seconds.`,
      'The source may be unreachable. Everything else in this state is unaffected, and you can try this one again.',
    );
  }

  if (query.isError) {
    return failure(
      query.error instanceof Error
        ? query.error.message
        : 'This artifact could not be read, and no reason was recorded.',
      'Everything else in this state rendered from data that was already reconciled.',
    );
  }

  const reply = query.data;

  if (reply === undefined) {
    return failure(
      'This artifact returned nothing at all.',
      'That is a fault in the reconciliation rather than in your repository. Try reading it again.',
    );
  }

  if (!reply.ok) {
    // The typed failure already names what failed and what to do next
    // (ipc-surface.md rule 5, Principle V), so it is passed straight through
    // rather than restated in this application's own words.
    return failure(
      reply.message,
      artifact.required
        ? 'This artifact’s SDLC definition marks it as required for this state, so the state is incomplete without it.'
        : 'This artifact is declared as optional, so the state may legitimately be complete without it.',
    );
  }

  const content = reply.value;
  const large = content.truncated || content.byteLength > LARGE_ARTIFACT_BYTES;
  const show = !large || opened;

  return (
    <article className="artifact" aria-labelledby={headingId}>
      <ArtifactProvenance
        name={artifact.name}
        kind={content.kind}
        provider={content.provider}
        locator={content.locator}
        reconciledAt={content.reconciledAt}
        headingId={headingId}
      />

      {content.truncated ? (
        <p className="artifact__note">
          This artifact is {formatBytes(content.byteLength)} and was truncated when it was read, so
          what follows is the beginning of it rather than all of it.
        </p>
      ) : null}

      {large ? (
        <p className="artifact__disclosure">
          <button
            className="button button--small"
            type="button"
            aria-expanded={opened}
            onClick={() => setOpened((was) => !was)}
          >
            {opened ? 'Hide this artifact' : 'Show this artifact'}
            <span className="sr-only"> — {artifact.name}</span>
          </button>
          <span className="artifact__size">
            {formatBytes(content.byteLength)}, held closed so that opening this state stays quick.
          </span>
        </p>
      ) : null}

      {show ? (
        <div className="artifact__body">
          {/* The lazy markdown chunk sits on local disk beside the page, so this
              wait is not provider-bound and Principle X's ten-second ceiling does
              not apply to it — the same reasoning `App.tsx` records for its route
              chunks. The boundary is per artifact so one slow parse cannot delay
              its siblings. */}
          <Suspense
            fallback={
              <p className="pending" role="status">
                Preparing to render this artifact&hellip;
              </p>
            }
          >
            {content.kind === KIND_MARKDOWN ? (
              <MarkdownView content={content.content} />
            ) : content.kind === KIND_TEST_RESULTS ? (
              <TestResultsArtifact content={content.content} />
            ) : (
              <TrackerArtifact content={content.content} provider={content.provider} />
            )}
          </Suspense>
        </div>
      ) : null}
    </article>
  );
}
