/**
 * T092 — issue-tracker content, attributed to the system it came from
 * (FR-017, FR-018, Story 3 acceptance 2).
 *
 * Ticket fields and comments are the least trustworthy text this application
 * handles: anyone with an account on the tracker can write them, and they arrive
 * as rich text. So this view renders them as **text and nothing else**. There is
 * no parser here, no markup interpretation, and no raw-markup escape hatch — the
 * characters the provider sent are the characters that appear, React escapes
 * them on the way into the DOM, and there is no path by which a ticket comment
 * becomes an element. Given a desktop renderer, that is host code execution
 * averted rather than a formatting decision (FR-020, Principle IX, constitution
 * hardening constraint).
 *
 * Rendering it inert also keeps `react-markdown` out of this path, which matters
 * for the budget: the markdown parser is loaded lazily and only for documents
 * declared as markdown (Principle XII).
 *
 * The attribution is the provider id the definition declared — echoed back, not a
 * name this application knows (Principle II). `ArtifactProvenance` shows the same
 * id in the header; the sentence here says what it *means* for what follows:
 * this is somebody else's record, reproduced, and it is edited where it lives.
 */

import type { ReactElement } from 'react';

export interface TrackerArtifactProps {
  /** Untrusted producer output. Rendered as text, never parsed. */
  readonly content: string;
  /** The provider id the definition declared as this artifact's source. */
  readonly provider: string;
}

export function TrackerArtifact({ content, provider }: TrackerArtifactProps): ReactElement {
  if (content.trim() === '') {
    // Principle X: a deliberate nothing. "Read successfully, and empty" is a
    // different fact from "could not be read", and the two must not look alike.
    return (
      <p className="tracked tracked--empty">
        {provider} returned this artifact successfully, and it is empty.
      </p>
    );
  }

  return (
    <div className="tracked">
      <p className="tracked__attribution">
        Reproduced as text from {provider}, exactly as it was received. Edit it in the system that
        owns it — this dashboard does not write to it.
      </p>
      <pre className="tracked__body">{content}</pre>
    </div>
  );
}
