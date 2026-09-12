/**
 * T093 — where an artifact came from, and when it was last reconciled (FR-018).
 *
 * Story 3's whole claim is that the engineer can *trust what they are reading or
 * know that it is stale*. That is only true if every artifact carries its source
 * and its reconciliation time, so this header is not decoration around the
 * content — it is the part that makes the content admissible.
 *
 * The locator is shown and never linked. A path or an issue reference crossing
 * the bridge is display data: the renderer has no filesystem and no network, and
 * ipc-surface.md rule 4 says a path string in `ArtifactContent` is not resolvable
 * here. Rendering it as a link would offer a capability that does not exist.
 *
 * The provider is the definition's own id for it, echoed back, not a name this
 * application knows (Principle II).
 */

import type { ReactElement } from 'react';

export interface ArtifactProvenanceProps {
  /** The artifact's declared name, from the manifest. */
  readonly name: string;
  /** The declared kind, echoed from the manifest rather than interpreted. */
  readonly kind: string;
  /** The provider id the definition declared as this artifact's source. */
  readonly provider: string;
  /** Display only — the renderer cannot resolve it (ipc-surface.md rule 4). */
  readonly locator: string;
  readonly reconciledAt: string;
  /** Id for the name element, so the artifact's region can be labelled by it. */
  readonly headingId: string;
}

/** Provider timestamps are validated as strings, not as dates. An unparseable one shows as recorded. */
function formatTimestamp(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

export function ArtifactProvenance({
  name,
  kind,
  provider,
  locator,
  reconciledAt,
  headingId,
}: ArtifactProvenanceProps): ReactElement {
  return (
    <header className="artifact__head">
      <h4 className="artifact__name" id={headingId}>
        {name}
      </h4>
      <p className="artifact__provenance">
        <span className="artifact__fact">
          <span className="artifact__fact-label">Kind</span>
          <span className="artifact__fact-value">{kind}</span>
        </span>
        <span className="artifact__fact">
          <span className="artifact__fact-label">Source</span>
          <span className="artifact__fact-value">
            {provider}
            {locator === '' ? null : <code className="artifact__locator">{locator}</code>}
          </span>
        </span>
        <span className="artifact__fact">
          <span className="artifact__fact-label">Last reconciled</span>
          <span className="artifact__fact-value">
            <time dateTime={reconciledAt}>{formatTimestamp(reconciledAt)}</time>
          </span>
        </span>
      </p>
    </header>
  );
}
