/**
 * T027 — a small glob matcher for the filesystem provider.
 *
 * Deliberately tiny and dependency-free. The manifest's `items.discover[].glob`
 * and file-backed locators are the only globs this application ever evaluates,
 * and they use three wildcards:
 *
 *   `*`   any run of characters within one path segment
 *   `**`  any number of whole path segments, including none
 *   `?`   exactly one character within one path segment
 *
 * Everything the matcher sees is a POSIX-separated, root-relative path. Paths are
 * normalised to `/` before they reach here, so the matcher is identical on every
 * platform (constitution Principle I) — a pattern that matches on Linux matches
 * on Windows, because nothing here ever sees a backslash.
 */

/** Characters that make a locator a pattern rather than a literal path. */
export function isGlob(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

/**
 * The literal directory prefix of a pattern, e.g. `docs/items` for
 * `docs/items/{star}/item.json`.
 *
 * The walker starts there instead of at the root, so a glob that names a folder
 * does not cost a full-repository traversal.
 */
export function staticPrefix(pattern: string): string {
  const segments = normalisePattern(pattern).split('/');
  const literal: string[] = [];
  for (const segment of segments) {
    if (isGlob(segment)) break;
    literal.push(segment);
  }
  // When no segment is a wildcard the last literal is the file itself, not a
  // directory to walk.
  if (literal.length === segments.length) literal.pop();
  return literal.filter((segment) => segment !== '' && segment !== '.').join('/');
}

/**
 * Compiles a pattern once so a caller can test many paths against it.
 *
 * Never throws: every regular expression this builds is constructed from escaped
 * literals and a fixed set of wildcard expansions, so it is always valid.
 */
export function compileGlob(pattern: string): RegExp {
  const segments = normalisePattern(pattern).split('/');
  let source = '^';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? '';
    const last = index === segments.length - 1;
    if (segment === '**') {
      // `**` spans whole segments. As a trailing segment it matches everything
      // below; elsewhere it matches zero or more complete directory names, which
      // is why it supplies its own separator.
      source += last ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    source += segmentSource(segment);
    if (!last) source += '/';
  }
  return new RegExp(`${source}$`);
}

/** Convenience for a single test. Prefer `compileGlob` when matching many paths. */
export function matchGlob(pattern: string, candidate: string): boolean {
  return compileGlob(pattern).test(normalisePattern(candidate));
}

function segmentSource(segment: string): string {
  let source = '';
  for (const character of segment) {
    if (character === '*') {
      source += '[^/]*';
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeLiteral(character);
  }
  return source;
}

function escapeLiteral(character: string): string {
  return /[\\^$.|+()[\]{}]/.test(character) ? `\\${character}` : character;
}

/** Backslashes to slashes, no leading `./`, no repeated or trailing separators. */
function normalisePattern(pattern: string): string {
  const posix = pattern.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const withoutLeadingDot = posix.startsWith('./') ? posix.slice(2) : posix;
  return withoutLeadingDot.length > 1 && withoutLeadingDot.endsWith('/')
    ? withoutLeadingDot.slice(0, -1)
    : withoutLeadingDot;
}
