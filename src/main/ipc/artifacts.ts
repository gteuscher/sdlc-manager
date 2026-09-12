/**
 * T088 — the `getArtifact` channel.
 *
 * Reads one declared artifact through the provider the manifest names, for any of
 * the three kinds a manifest may declare (`markdown`, `tracker`, `test-results`),
 * and returns the content together with its provenance and the time it was
 * reconciled (FR-017, FR-018).
 *
 * ## Content arrives inert (ipc-surface.md rule 6, FR-020)
 *
 * What crosses is **text**: markdown source, tracker text, or the JSON of a test
 * run. This module performs no conversion of any kind — it does not render
 * markdown, does not build HTML, and does not interpolate provider content into
 * any string it constructs. The renderer parses markdown to React elements behind
 * a sanitiser, and the renderer is sandboxed with no Node to reach, so an escaped
 * sanitiser has nothing to escape *to*. Building HTML here would put the one
 * dangerous transformation on the privileged side of the boundary.
 *
 * ## Large artifacts (FR-021)
 *
 * A very long document must not make the tab unusable, so the content is capped
 * and `truncated` is set. `byteLength` keeps reporting the artifact's **real**
 * size rather than the size of what was sent: the point of the field is to tell
 * the engineer how much was left out, and a `byteLength` equal to the truncated
 * length would say nothing was.
 *
 * ## Failures are values (rule 5)
 *
 * A missing file, an expired credential, an artifact the manifest does not
 * declare: each returns a `Result` failure naming what failed, so the state tab
 * renders the rest of itself around an in-place error with a retry (FR-019,
 * Principle X).
 */

import { findState, type ArtifactDecl, type ArtifactKind } from '@core/model/declared.js';
import { CHANNELS, artifactArgSchema, getArtifactReplySchema } from '@core/ipc/schema.js';
import type { ArtifactContent } from '@core/model/observed.js';
import { fail, ok, type Result } from '@core/model/result.js';
import type { Provider, RepoContext } from '@providers/contract.js';

import type { Reconciler } from '../reconcile/index.js';

import { invalidRequestResult, validated, type RegisteredChannel } from './validate.js';

/**
 * The ceiling on what crosses the bridge in one reply. Half of what the providers
 * themselves cap at, because this is the figure that governs what the renderer has
 * to lay out in one frame.
 */
const MAX_CONTENT_CHARACTERS = 256 * 1024;

/** The kinds a manifest may declare. A reply claiming any other kind is refused. */
const ARTIFACT_KINDS: readonly ArtifactKind[] = ['markdown', 'tracker', 'test-results'];

export interface ArtifactHandlerDeps {
  readonly reconciler: Reconciler;
  /** Overridable so a test can exercise truncation without a huge fixture. */
  readonly maxContentCharacters?: number;
}

export interface ArtifactArgs {
  readonly key: string;
  readonly stateId: string;
  readonly artifactId: string;
}

export interface ArtifactHandlers {
  getArtifact(args: ArtifactArgs): Promise<Result<ArtifactContent>>;
  readonly channels: readonly RegisteredChannel[];
}

export function createArtifactHandlers(deps: ArtifactHandlerDeps): ArtifactHandlers {
  const limit = deps.maxContentCharacters ?? MAX_CONTENT_CHARACTERS;

  const getArtifact = async (args: ArtifactArgs): Promise<Result<ArtifactContent>> => {
    const located = locateArtifact(deps.reconciler, args);
    if (!located.ok) return located;

    const { decl, provider, ctx } = located.value;

    let read: Result<ArtifactContent>;
    try {
      read = await provider.readArtifact(ctx, decl, args.key);
    } catch (error) {
      // A provider that throws has broken rule 1 of the provider contract.
      // Absorbed here so one misbehaving adapter costs one artifact, not the tab.
      return fail(
        'invalid_response',
        `Reading the '${decl.name}' artifact failed unexpectedly: ${describeError(error)}.`,
      );
    }
    if (!read.ok) return read;

    return normalise(decl, read.value, limit);
  };

  const channels: RegisteredChannel[] = [
    {
      channel: CHANNELS.getArtifact,
      invoke: validated(
        CHANNELS.getArtifact,
        artifactArgSchema,
        getArtifactReplySchema,
        getArtifact,
        invalidRequestResult<ArtifactContent>,
      ),
    },
  ];

  return { getArtifact, channels };
}

interface LocatedArtifact {
  readonly decl: ArtifactDecl;
  readonly provider: Provider;
  readonly ctx: RepoContext;
}

/**
 * Resolves the request against the loaded definition.
 *
 * Every step names what was not found, because "artifact unavailable" is not an
 * actionable message and Principle V asks for one that is.
 */
function locateArtifact(
  reconciler: Reconciler,
  args: ArtifactArgs,
): Result<LocatedArtifact> {
  const entry = reconciler.find(args.key);
  if (entry === undefined) {
    return fail('not_found', `No item with key "${args.key}" is currently listed.`, { field: 'key' });
  }

  const { definition, ctx, providers, repository } = entry.repository;
  if (definition === null || ctx === null || providers === null) {
    return fail(
      'unavailable',
      repository.problem ??
        'This repository has no usable lifecycle manifest, so it declares no artifacts to read.',
    );
  }

  const state = findState(definition, args.stateId);
  if (state === undefined) {
    return fail(
      'not_found',
      `This lifecycle declares no state with id "${args.stateId}". It may have been removed when the SDLC package was upgraded.`,
      { field: 'stateId' },
    );
  }

  const decl = state.artifacts.find((candidate) => candidate.id === args.artifactId);
  if (decl === undefined) {
    return fail(
      'not_found',
      `The "${state.name}" state declares no artifact with id "${args.artifactId}".`,
      { field: 'artifactId' },
    );
  }

  const provider = providers.get(decl.provider);
  if (provider === undefined) {
    const health = providers.unsupported.get(decl.provider);
    return fail(
      'unavailable',
      health?.message ??
        `The '${decl.name}' artifact is read by the '${decl.provider}' provider, which is not available in this build.`,
      { field: 'provider' },
    );
  }

  return ok({ decl, provider, ctx });
}

/**
 * Enforces the reply contract on whatever the provider returned.
 *
 * Providers are untrusted producers as much as the systems they read are
 * (Principle IX), so the kind, the provenance, and the size are all checked here
 * rather than assumed.
 */
function normalise(
  decl: ArtifactDecl,
  content: ArtifactContent,
  limit: number,
): Result<ArtifactContent> {
  if (!ARTIFACT_KINDS.some((kind) => kind === content.kind)) {
    return fail(
      'invalid_response',
      `The '${decl.name}' artifact came back as kind '${content.kind}', which is not one this contract carries. Nothing was rendered.`,
      { field: 'kind' },
    );
  }

  const truncated = content.truncated || content.content.length > limit;
  // Cut, never annotate: a marker appended to the text would be content this
  // process injected into a document the renderer is about to parse. The
  // `truncated` flag is the honest channel for saying so.
  const text = content.content.length > limit ? content.content.slice(0, limit) : content.content;

  if (content.kind === 'test-results' && !truncated) {
    // A test run is structured data the renderer has to read. Validating it at
    // this boundary means an unparseable run is reported in place, naming the
    // artifact, rather than becoming a renderer exception (FR-019, Principle IX).
    try {
      JSON.parse(text);
    } catch (error) {
      return fail(
        'invalid_response',
        `The '${decl.name}' test results are not valid JSON: ${describeError(error)}.`,
      );
    }
  }

  return ok({
    artifactId: decl.id,
    kind: content.kind,
    // Provenance, so every artifact is attributed to its source (FR-018).
    provider: content.provider === '' ? decl.provider : content.provider,
    // For display only; the renderer cannot resolve it (rule 4).
    locator: content.locator,
    content: text,
    reconciledAt: content.reconciledAt,
    truncated,
    // The artifact's real size, not the size of what was sent (FR-021).
    byteLength: content.byteLength,
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
