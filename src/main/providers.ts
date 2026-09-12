/**
 * The provider factory registry: manifest `ProviderDecl.kind` to an adapter.
 *
 * Three rules shape this file, and each is a requirement rather than a
 * preference.
 *
 *   1. **An unknown kind is not a crash.** A manifest may declare a provider this
 *      build has no adapter for — a newer package on an older dashboard, a
 *      lifecycle written for a provider still on someone's branch. The provider is
 *      then simply *absent*, and its health reports `status: 'unsupported'` naming
 *      the kind. The repository still lists, its other providers still read, and
 *      the rest of the dashboard still works (Principle III's blast-radius rule,
 *      FR-026, FR-037).
 *
 *   2. **Credentials arrive here and travel no other way.** A secret is read from
 *      the `SecretStore` by the composition root, handed to the factory through
 *      `ProviderOptions.credential`, and never appears in a health message, a
 *      `Result`, a log line, or anywhere near the IPC surface (Principle III,
 *      provider-interface.md rule 4, ipc-surface.md rule 3). The factory below
 *      never interpolates `credential` into any string.
 *
 *   3. **Repository configuration is overlaid before construction, not after.**
 *      A manifest's `repo_config` may declare keys shaped `providers.<id>.<setting>`
 *      (sdlc-manifest.md §3, validation rule 12). Those are provider settings the
 *      repository supplies, so they must be merged into `ProviderDecl.settings`
 *      *before* the adapter parses them — an adapter that had to consult the
 *      repository configuration itself would have to know what a repository is.
 *      Gate overrides (`gates.<id>.<prop>`) are deliberately left alone: providers
 *      read those from `RepoContext.config` and honour them only for a gate
 *      declaring `configurable: true`, which is a judgement that belongs to the
 *      adapter reading the gate.
 *
 * Nothing here is module-level mutable state: the factory table is produced by a
 * function, and every provider instance lives in the `ProviderSet` a caller holds
 * (Principle VIII).
 */

import type { ProviderDecl, ProviderId, ProviderKind, SdlcDefinition } from '@core/model/declared.js';
import type { ProviderHealth } from '@core/model/observed.js';
import type { Provider, ProviderFactory } from '@providers/contract.js';
import { nowIso } from '@providers/contract.js';
import { createFilesystemProvider } from '@providers/filesystem/index.js';
import { createGithubProvider } from '@providers/github/index.js';
import { createJiraProvider } from '@providers/jira/index.js';

/** Kind to adapter. A kind absent from this table is unsupported, not fatal. */
export type ProviderFactories = Readonly<Record<ProviderKind, ProviderFactory>>;

/**
 * The adapters this build ships.
 *
 * `checks` and `github-checks` are both listed in sdlc-manifest.md §3's kind
 * vocabulary. A `checks` provider reads recorded check results from the local
 * filesystem — which is what makes a fully offline lifecycle expressible
 * (FR-036) — and `github-checks` reads them from GitHub. They are aliases of the
 * two adapters that already read those systems, not adapters of their own.
 *
 * Returned from a function rather than exported as a constant so that no caller
 * can mutate a shared table (Principle VIII).
 */
export function defaultProviderFactories(): ProviderFactories {
  return {
    filesystem: createFilesystemProvider,
    checks: createFilesystemProvider,
    jira: createJiraProvider,
    github: createGithubProvider,
    'github-checks': createGithubProvider,
  };
}

export interface ProviderSetDeps {
  /** Injected so a test can supply fakes without touching the real adapters. */
  readonly factories?: ProviderFactories;
  /**
   * Reads a credential for one provider id. Called once per declaration, at
   * construction. The value never leaves the factory call.
   */
  readonly credentialFor?: (providerId: ProviderId) => Promise<string | undefined>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export interface ProviderSet {
  /** The adapter for a declared id, or `undefined` when its kind is unsupported. */
  get(id: ProviderId): Provider | undefined;
  /** Every provider id the definition declares, constructed or not. */
  readonly declared: readonly ProviderId[];
  /** Health for the declarations no factory could construct. Reported, never thrown. */
  readonly unsupported: ReadonlyMap<ProviderId, ProviderHealth>;
  /**
   * Health for every declared provider. Constructed adapters are asked; absent
   * ones report `unsupported` naming their kind. Never rejects: a provider that
   * throws from `health()` has broken its contract and is reported as unreachable
   * rather than allowed to take the repository down.
   */
  health(): Promise<Record<ProviderId, ProviderHealth>>;
}

/**
 * Constructs every provider a definition declares, applying the repository's
 * configuration overlay first and passing each provider its own credential.
 */
export async function createProviderSet(
  definition: SdlcDefinition,
  repositoryConfig: Readonly<Record<string, unknown>>,
  deps: ProviderSetDeps = {},
): Promise<ProviderSet> {
  const factories = deps.factories ?? defaultProviderFactories();
  const providers = new Map<ProviderId, Provider>();
  const unsupported = new Map<ProviderId, ProviderHealth>();
  const declarations = new Map<ProviderId, ProviderDecl>();

  for (const declared of definition.providers) {
    const decl = applyRepositorySettings(declared, repositoryConfig);
    declarations.set(decl.id, decl);

    const factory = factories[decl.kind];
    if (factory === undefined) {
      // Absent, not fatal: the repository still lists and its other providers
      // still read (FR-026, FR-037).
      unsupported.set(decl.id, unsupportedHealth(decl, describeUnsupported(decl, factories), deps.now));
      continue;
    }

    // A credential is read per provider and handed straight to the factory. It is
    // never held in a variable that outlives this loop iteration, never logged,
    // and never interpolated into a message.
    let credential: string | undefined;
    try {
      credential = await deps.credentialFor?.(decl.id);
    } catch {
      // A credential store that fails reads as "no credential", which the adapter
      // reports as `not_configured` naming what it needs (FR-035). The thrown
      // value is discarded rather than wrapped: it could echo the secret.
      credential = undefined;
    }

    try {
      providers.set(
        decl.id,
        factory({ decl, credential, fetch: deps.fetch, now: deps.now }),
      );
    } catch (error) {
      // An adapter that throws from its own factory is broken, not the manifest's
      // fault; it is reported in the same shape as an unknown kind so that one
      // broken adapter costs one provider rather than the whole repository. The
      // message is the error's, never the credential's.
      unsupported.set(
        decl.id,
        unsupportedHealth(
          decl,
          `the '${decl.kind}' adapter could not be constructed: ${describeError(error)}`,
          deps.now,
        ),
      );
    }
  }

  return {
    get(id: ProviderId): Provider | undefined {
      return providers.get(id);
    },

    declared: [...declarations.keys()],

    unsupported,

    async health(): Promise<Record<ProviderId, ProviderHealth>> {
      const report: Record<ProviderId, ProviderHealth> = {};
      for (const [id, decl] of declarations) {
        const absent = unsupported.get(id);
        if (absent !== undefined) {
          report[id] = absent;
          continue;
        }
        const provider = providers.get(id);
        if (provider === undefined) continue;
        try {
          report[id] = await provider.health();
        } catch (error) {
          // Rule 1 says a provider never throws. When one does anyway, the
          // failure is a value here too.
          report[id] = {
            providerId: id,
            kind: decl.kind,
            status: 'unreachable',
            message:
              `The '${id}' provider failed while reporting its own health: ${describeError(error)}. ` +
              'Items it supplies are shown from the last reconciled data.',
            checkedAt: nowIso(deps.now),
          };
        }
      }
      return report;
    },
  };
}

/**
 * Overlays a repository's `providers.<id>.<setting>` configuration onto one
 * declaration's settings.
 *
 * Validation rule 12 has already established at manifest load that every
 * `repo_config.key` resolves, so the keys arriving here are known-good paths; the
 * repository's *values* are validated separately, before they are ever stored
 * (FR-025). Keys addressing anything but this provider are ignored, including the
 * `gates.<id>.<prop>` overrides, which providers read from `RepoContext.config`
 * and honour only for a gate declaring `configurable: true`.
 *
 * The declaration is copied rather than mutated: the manifest is immutable for a
 * package version, and two repositories on one package must not see each other's
 * settings.
 */
export function applyRepositorySettings(
  decl: ProviderDecl,
  repositoryConfig: Readonly<Record<string, unknown>>,
): ProviderDecl {
  const prefix = `providers.${decl.id}.`;
  const settings: Record<string, unknown> = structuredCopy(decl.settings);
  let overlaid = false;

  for (const [key, value] of Object.entries(repositoryConfig)) {
    if (!key.startsWith(prefix)) continue;
    // An empty value is not an override: a repository leaving a field blank keeps
    // the manifest's declaration rather than replacing it with nothing.
    if (value === undefined || value === null || value === '') continue;
    const path = key.slice(prefix.length).split('.').filter((segment) => segment !== '');
    if (path.length === 0) continue;
    setAtPath(settings, path, value);
    overlaid = true;
  }

  if (!overlaid) return decl;
  return { id: decl.id, kind: decl.kind, settings };
}

/** Names the kind, and the kinds this build does know, so the report is actionable. */
function describeUnsupported(decl: ProviderDecl, factories: ProviderFactories): string {
  const known = Object.keys(factories).sort().join(', ');
  return (
    `this build has no adapter for provider kind '${decl.kind}'. ` +
    `The kinds it can read are: ${known}. ` +
    'Everything this provider would have supplied is absent; the rest of the lifecycle still reads.'
  );
}

function unsupportedHealth(decl: ProviderDecl, detail: string, now?: () => Date): ProviderHealth {
  return {
    providerId: decl.id,
    kind: decl.kind,
    status: 'unsupported',
    // Names the provider and the kind, per FR-026. Carries no credential, because
    // no credential is in scope here.
    message: `The '${decl.id}' provider is unsupported: ${detail}`,
    checkedAt: nowIso(now),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A deep copy of a plain settings object, so an overlay cannot reach the manifest. */
function structuredCopy(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = isPlainObject(entry) ? structuredCopy(entry) : entry;
  }
  return copy;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Writes `value` at a dotted path, creating intermediate objects as needed. */
function setAtPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (segment === undefined) return;
    const next = cursor[segment];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
      continue;
    }
    cursor = next;
  }
  const last = path[path.length - 1];
  if (last === undefined) return;
  cursor[last] = value;
}
