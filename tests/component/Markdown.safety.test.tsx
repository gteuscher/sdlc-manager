/**
 * T087 — the safety property, asserted rather than assumed (FR-020, Principle IX).
 *
 * The constitution is unusually blunt about why this file exists: this project
 * renders markdown from repositories and rich text from issue trackers inside a
 * desktop renderer, so a Principle IX violation here is **host code execution,
 * not merely a cross-site scripting defect**. A repository's specification
 * document is written by whoever can push to that repository, and a ticket
 * description by anyone with an account on the tracker. Neither is trusted input.
 *
 * The defence is structural, so the assertions are too. It is not enough to
 * check that today's payloads are neutralised — a sanitiser allow-list is a
 * moving target and the next payload is not in this file. So this file asserts
 * both halves:
 *
 *   - **behaviour** — active content embedded in provider markdown does not
 *     execute, and no element capable of executing it reaches the document;
 *   - **structure** — no raw HTML string is injected anywhere in the renderer,
 *     because `dangerouslySetInnerHTML` appears nowhere in `src/renderer`. That
 *     is the property that makes the behavioural assertions durable, and it is
 *     checked over the source rather than inferred from a passing render.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import MarkdownArtifact from '@renderer/components/MarkdownArtifact';

declare global {
  /** Set by any payload below that manages to execute. Nothing should ever set it. */
  var __executed: boolean | undefined;
}

/** Everything a provider might embed in a document it controls. */
const HOSTILE = [
  '# A specification',
  '',
  '<script>globalThis.__executed = true;</script>',
  '',
  '<img src="x" onerror="globalThis.__executed = true" />',
  '',
  '<iframe src="https://example.invalid/"></iframe>',
  '',
  '<svg><script>globalThis.__executed = true;</script></svg>',
  '',
  '<div onclick="globalThis.__executed = true">click me</div>',
  '',
  '[a link](javascript:globalThis.__executed=true)',
  '',
  '![an image](javascript:globalThis.__executed=true)',
  '',
  '<a href="javascript:globalThis.__executed=true">another link</a>',
  '',
  'Ordinary prose survives all of that.',
].join('\n');

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe('markdown from an untrusted producer', () => {
  it('executes nothing a provider embeds in a document', () => {
    globalThis.__executed = undefined;

    const { container } = render(<MarkdownArtifact content={HOSTILE} />);

    // Nothing ran, by any of the routes above.
    expect(globalThis.__executed).toBeUndefined();

    // And nothing capable of running reached the document. `react-markdown` is
    // configured without `rehype-raw`, so raw HTML is never parsed into the
    // tree at all — the payload is dropped rather than filtered.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('object')).toBeNull();
    expect(container.querySelector('embed')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.querySelector('[onload]')).toBeNull();

    // No raw HTML string was injected: the payload is not in the DOM as markup.
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('<iframe');
    expect(container.innerHTML).not.toContain('onerror');

    // The document around the payload still rendered, so this is a defused
    // document rather than a refused one.
    expect(screen.getByText(/ordinary prose survives all of that/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'A specification' })).toBeDefined();
  });

  it('defuses a dangerous URL scheme rather than putting it in an href', () => {
    const { container } = render(
      <MarkdownArtifact content={'[a link](javascript:globalThis.__executed=true)'} />,
    );

    const href = container.querySelector('a')?.getAttribute('href') ?? '';
    expect(href.toLowerCase()).not.toContain('javascript:');
  });

  it('renders ordinary GitHub-flavoured markdown as React elements', () => {
    render(
      <MarkdownArtifact
        content={[
          '| Gate | Result |',
          '| --- | --- |',
          '| Weave tension | held |',
          '',
          '- [x] warp set',
          '- [ ] weft set',
          '',
          '~~withdrawn~~',
        ].join('\n')}
      />,
    );

    // `remark-gfm` is on because repository markdown actually uses these.
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Gate' })).toBeDefined();
    expect(screen.getByText('held')).toBeDefined();
    expect(screen.getAllByRole('checkbox').length).toBe(2);
    expect(screen.getByText('withdrawn')).toBeDefined();
  });

  it('injects no raw HTML string anywhere in the renderer', () => {
    // `import.meta.url` is an http URL under jsdom, so the project root comes
    // from the process instead. Vitest runs from it.
    const renderer = join(process.cwd(), 'src', 'renderer');
    const offenders = sourceFiles(renderer).filter((file) =>
      readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML'),
    );

    // The structural half of FR-020. `react-markdown` renders to React elements
    // and never produces an HTML string, so there is no legitimate reason for
    // this API to appear — and if it ever does, the behavioural assertions above
    // stop being sufficient.
    expect(offenders).toEqual([]);
  });
});
