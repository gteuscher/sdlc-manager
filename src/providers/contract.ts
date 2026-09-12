/**
 * T023 — the Provider interface, exactly as contracts/provider-interface.md §1.
 *
 * Every external system this application reads — the filesystem, Jira, GitHub, and
 * anything added later — is reached only through this interface. Application code
 * never imports a vendor SDK and never calls a vendor endpoint directly
 * (Principle III).
 *
 * There are **no write methods**. FR-034's read-only guarantee is expressed in the
 * type system rather than in discipline: a read-only release cannot accidentally
 * write, because no method exists to call. Adding writes later is additive — the
 * Planned Direction constraint that "adding write operations does not change how
 * items are read" is satisfied by leaving every method below untouched.
 */

import type {
  ArtifactDecl,
  GateDecl,
  ProviderDecl,
  ProviderId,
  ProviderKind,
  SdlcDefinition,
} from '@core/model/declared.js';
import type {
  ArtifactContent,
  GateResult,
  ItemKey,
  ProviderHealth,
  RepositoryId,
  Timestamp,
} from '@core/model/observed.js';
import type { Result } from '@core/model/result.js';

export type Unsubscribe = () => void;

/** Everything a provider needs to read one repository. Carries no credential. */
export interface RepoContext {
  readonly repositoryId: RepositoryId;
  /** Absolute path on disk. Meaningless to a remote provider, and ignored by one. */
  readonly repositoryPath: string;
  readonly definition: SdlcDefinition;
  /** Repository configuration, validated against the package's `repo_config`. */
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * One item as the provider sees it, in the system's own raw vocabulary.
 *
 * `rawState` is deliberately not a state id: translating a raw value into a
 * declared state is the engine's job, because the mapping lives in the manifest.
 * A provider that knows about states has leaked lifecycle knowledge into an
 * adapter (provider-interface.md rule 2).
 */
export interface RawItem {
  readonly key: ItemKey;
  readonly title?: string;
  readonly rawState?: string;
  readonly assignee?: string;
  readonly source: ProviderId;
  /** Identity fields extracted per `items.identity`, for locator templating. */
  readonly fields: Readonly<Record<string, string>>;
}

export interface RawState {
  readonly value: string;
  readonly observedAt: Timestamp;
}

export interface Provider {
  readonly id: ProviderId;
  readonly kind: ProviderKind;

  /** Configured and reachable? Never throws; reports instead. */
  health(): Promise<ProviderHealth>;

  /** Items this provider considers the engineer's own, per the manifest's discovery rules. */
  discoverItems(ctx: RepoContext): Promise<Result<RawItem[]>>;

  /** The raw status value for an item. Mapping to a state is the engine's job. */
  readState(ctx: RepoContext, key: ItemKey): Promise<Result<RawState>>;

  /** Artifact content for a declared locator. */
  readArtifact(ctx: RepoContext, decl: ArtifactDecl, key: ItemKey): Promise<Result<ArtifactContent>>;

  /** The recorded result for a gate, or `not_evaluated` when nothing is recorded. */
  readGate(ctx: RepoContext, decl: GateDecl, key: ItemKey): Promise<Result<GateResult>>;

  /** Fires when this provider's data may have changed. Watch locally, poll remotely. */
  subscribe(ctx: RepoContext, onChange: () => void): Unsubscribe;
}

/** What the composition root passes a provider factory. Credentials arrive here, and nowhere else. */
export interface ProviderOptions {
  readonly decl: ProviderDecl;
  /**
   * From `safeStorage`. Never logged, never returned in a `Result` failure, never
   * crosses the IPC surface (Principle III, provider-interface.md rule 4).
   */
  readonly credential?: string;
  /** Injected so tests need no network and no clock. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export type ProviderFactory = (options: ProviderOptions) => Provider;

/** Convenience for the many places that stamp a reconciliation time. */
export function nowIso(now?: () => Date): Timestamp {
  return (now ? now() : new Date()).toISOString();
}

/** A `not_evaluated` result. Absence is never success (provider-interface.md rule 5). */
export function notEvaluated(gateId: string, detail: string | null = null): GateResult {
  return { gateId, status: 'not_evaluated', evaluatedAt: null, evidence: null, detail };
}

export function healthy(providerId: ProviderId, kind: ProviderKind, now?: () => Date): ProviderHealth {
  return {
    providerId,
    kind,
    status: 'ok',
    message: `${providerId} is configured and reachable`,
    checkedAt: nowIso(now),
  };
}

export function unconfigured(
  providerId: ProviderId,
  kind: ProviderKind,
  missing: string,
  now?: () => Date,
): ProviderHealth {
  return {
    providerId,
    kind,
    status: 'not_configured',
    // Names the provider and what it needs, rather than failing (FR-026, FR-035).
    message: `${providerId} is not configured: ${missing}`,
    checkedAt: nowIso(now),
  };
}

export type { ArtifactDecl, GateDecl, ProviderDecl, ProviderId, ProviderKind };
