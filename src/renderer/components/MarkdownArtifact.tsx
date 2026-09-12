/**
 * T089 — markdown from a repository, rendered without ever building HTML.
 *
 * This is the most security-sensitive component in the application, and the
 * constitution says why in one sentence: this project renders markdown from
 * repositories and rich text from issue trackers inside a desktop renderer, so a
 * Principle IX violation here **is host code execution, not merely XSS**.
 *
 * The defence is structural rather than filtering:
 *
 *   1. `react-markdown` renders to **React elements**. It never produces an HTML
 *      string, so there is nothing to inject and React's raw-markup escape hatch
 *      is not merely avoided here — it has no role to play. Nothing in
 *      `src/renderer` uses it, and `Markdown.safety.test.tsx` asserts exactly
 *      that, over the source, so the property cannot regress unnoticed.
 *   2. **Raw HTML is not parsed.** `rehype-raw` is deliberately absent, so a
 *      `<script>`, an `<iframe>`, or an `onerror=` attribute embedded in a
 *      provider's markdown never reaches the tree at all.
 *   3. `rehype-sanitize` runs anyway, as defence in depth, on the off chance a
 *      future plugin reintroduces raw nodes.
 *   4. `react-markdown`'s default URL transform strips dangerous protocols, so a
 *      `javascript:` link in a repository's spec document is defused before it
 *      becomes an `href`.
 *   5. The renderer itself is sandboxed with context isolation on and Node off,
 *      so an escaped sanitiser has no Node to reach (ipc-surface.md §4).
 *
 * `remark-gfm` is on because the documents this reads are ordinary repository
 * markdown: tables, task lists, strikethrough, and autolinks are what people
 * actually write.
 *
 * **This module is the lazy boundary.** It is the only place `react-markdown`,
 * `remark-gfm`, and `rehype-sanitize` are imported, and it is reached exclusively
 * through `React.lazy` in `routes/ItemDetail.tsx`. That is not an optimisation:
 * Principle XII states the architectural consequence directly — React, a router,
 * a schema validator, a markdown parser, and a sanitizer exceed the 150 KB
 * initial budget together, so markdown rendering MUST be lazy-loaded into the
 * detail route. `.size-limit.json` budgets this chunk by name.
 *
 * Default export, because that is what `React.lazy` resolves.
 */

import type { ReactElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

export interface MarkdownArtifactProps {
  /** Untrusted producer output. Treated as text until `react-markdown` parses it. */
  readonly content: string;
}

export default function MarkdownArtifact({ content }: MarkdownArtifactProps): ReactElement {
  if (content.trim() === '') {
    // Principle X: a deliberate nothing. A blank frame here is indistinguishable
    // from a document that failed to load.
    return (
      <p className="markdown markdown--empty">
        This document was read successfully and is empty.
      </p>
    );
  }

  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </Markdown>
    </div>
  );
}
