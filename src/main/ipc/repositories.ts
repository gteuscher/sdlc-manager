/**
 * T101 — the repository and package channels.
 *
 * ## These write local application configuration only (rule 1, FR-023, FR-034)
 *
 * `registerRepository`, `updateRepositoryConfig`, `removeRepository`, and
 * `setCredential` are the *only* mutating methods on the entire IPC surface, and
 * every one of them writes under the app's user-data directory. None of them
 * reaches a system of record — not because the code is careful, but because no
 * provider has a write method to call (provider-interface.md §1). Read-only is
 * the absence of the capability.
 *
 * ## No credential crosses in either direction but in (rule 3)
 *
 * `setCredential` takes a secret *in* and returns `Result<void>`. Nothing here
 * returns a secret, logs one, or puts one in a failure message — the secret store
 * is the one module that ever holds plaintext, and it never interpolates it
 * either. The renderer can learn that a provider is unconfigured, never what its
 * credential is: that is what `Repository.providerStatus` carries.
 *
 * ## Validation is before the write, never during (FR-025)
 *
 * A rejected configuration returns naming the offending field and the reason, and
 * **nothing is written** — the prior configuration is retained intact, because the
 * registry is not touched until validation has passed. An invalid configuration
 * is never partially applied.
 */

import { z } from 'zod';

import {
  CHANNELS,
  listPackagesReplySchema,
  listRepositoriesReplySchema,
  packageSearchPathsReplySchema,
  registerRepositoryInputSchema,
  removeRepositoryArgSchema,
  repositoryResultSchema,
  setCredentialArgSchema,
  updateConfigArgSchema,
  voidResultSchema,
  type RegisterRepositoryInput,
  type SdlcPackageSummary,
} from '@core/ipc/schema.js';
import type { ConfigField, SdlcPackage } from '@core/model/declared.js';
import type { Repository } from '@core/model/observed.js';
import { fail, ok, type Result } from '@core/model/result.js';

import type { Cache } from '../cache/index.js';
import type { Reconciler } from '../reconcile/index.js';
import type { Registry } from '../registry/index.js';
import type { SecretStore } from '../secrets/index.js';

import {
  invalidRequestEmpty,
  invalidRequestResult,
  validated,
  type RegisteredChannel,
} from './validate.js';

/** The noun the interface uses when a package declares none (sdlc-manifest.md §3). */
const DEFAULT_UNIT = 'item';

/** A channel that takes no arguments takes no arguments. Anything else is rejected. */
const noArgsSchema = z.undefined();

export interface RepositoryHandlerDeps {
  readonly registry: Registry;
  readonly secrets: SecretStore;
  readonly cache: Cache;
  readonly reconciler: Reconciler;
  /**
   * The directories discovery scans, exactly as the composition root supplied
   * them — `defaultPackageRoots()` normally, or whatever `SDLC_PACKAGE_PATHS`
   * overrode them with. Reported rather than recomputed here, so what the view
   * shows is what the scan actually used and the two cannot drift.
   */
  readonly packageRoots: readonly string[];
}

export interface RepositoryHandlers {
  listPackages(): Promise<SdlcPackageSummary[]>;
  /** Where `listPackages` looked, so finding nothing is something an engineer can act on. */
  packageSearchPaths(): Promise<string[]>;
  listRepositories(): Promise<Repository[]>;
  registerRepository(input: RegisterRepositoryInput): Promise<Result<Repository>>;
  updateRepositoryConfig(args: { id: string; config: Record<string, unknown> }): Promise<Result<Repository>>;
  removeRepository(args: { id: string }): Promise<Result<void>>;
  setCredential(args: { providerId: string; secret: string }): Promise<Result<void>>;
  readonly channels: readonly RegisteredChannel[];
}

export function createRepositoryHandlers(deps: RepositoryHandlerDeps): RepositoryHandlers {
  const packageFor = (packageId: string): SdlcPackage | undefined =>
    deps.reconciler.packages().find((candidate) => candidate.id === packageId);

  const repositoryFor = (id: string): Repository | undefined =>
    deps.reconciler
      .repositories()
      .find((state) => state.repository.id === id)?.repository;

  const listPackages = async (): Promise<SdlcPackageSummary[]> =>
    deps.reconciler.packages().map(toPackageSummary);

  const packageSearchPaths = async (): Promise<string[]> => [...deps.packageRoots];

  const listRepositories = async (): Promise<Repository[]> =>
    deps.reconciler.repositories().map((state) => state.repository);

  const registerRepository = async (
    input: RegisterRepositoryInput,
  ): Promise<Result<Repository>> => {
    const pkg = packageFor(input.packageId);
    if (pkg === undefined) {
      return fail(
        'not_found',
        `No SDLC package with id "${input.packageId}" is installed on this machine. ` +
          'Install the agent package that carries the lifecycle, then register the repository.',
        { field: 'packageId' },
      );
    }

    // FR-045: a package carrying no usable manifest cannot be associated with a
    // repository, and the refusal names what is missing rather than guessing a
    // lifecycle for it.
    const usable = requireUsablePackage(pkg);
    if (!usable.ok) return usable;

    const config = input.config ?? {};
    const validation = validateRepositoryConfig(usable.value.repoConfig, config);
    if (!validation.ok) return validation;

    const added = await deps.registry.add({
      name: input.name,
      path: input.path,
      packageId: pkg.id,
      // Which package, at which version (FR-043). Recorded at registration, so a
      // later package upgrade is visible as a difference rather than silent.
      packageVersion: pkg.version,
      config,
    });
    if (!added.ok) return added;

    await deps.reconciler.reload();
    await deps.reconciler.refresh({ repositoryId: added.value.id });

    const repository = repositoryFor(added.value.id);
    if (repository === undefined) {
      return fail(
        'conflict',
        'The repository was registered but could not be read back. Reopen the repositories view.',
      );
    }
    return ok(repository);
  };

  const updateRepositoryConfig = async (args: {
    id: string;
    config: Record<string, unknown>;
  }): Promise<Result<Repository>> => {
    const registered = await deps.registry.get(args.id);
    if (registered === undefined) {
      return fail('not_found', `No repository is registered with id ${args.id}.`, { field: 'id' });
    }

    const pkg = packageFor(registered.packageId);
    if (pkg === undefined) {
      return fail(
        'unavailable',
        `The '${registered.packageId}' SDLC package is no longer installed, so its configuration ` +
          'cannot be validated. The existing configuration is unchanged. Reinstall the package, ' +
          'or remove the registration.',
        { field: 'packageId' },
      );
    }

    const usable = requireUsablePackage(pkg);
    if (!usable.ok) return usable;

    // Validated before a single byte is written; a rejection leaves the prior
    // configuration intact (FR-025).
    const validation = validateRepositoryConfig(usable.value.repoConfig, args.config);
    if (!validation.ok) return validation;

    const updated = await deps.registry.updateConfig(args.id, args.config);
    if (!updated.ok) return updated;

    // The overlay onto provider settings happens at construction, so the providers
    // must be rebuilt for the new configuration to take effect.
    await deps.reconciler.reload();
    await deps.reconciler.refresh({ repositoryId: args.id });

    const repository = repositoryFor(args.id);
    if (repository === undefined) {
      return fail(
        'conflict',
        'The configuration was saved but the repository could not be read back. Reopen the repositories view.',
      );
    }
    return ok(repository);
  };

  const removeRepository = async (args: { id: string }): Promise<Result<void>> => {
    const removed = await deps.registry.remove(args.id);
    if (!removed.ok) return removed;

    // The cache is derived data; dropping it with the registration keeps no
    // orphaned copy of a repository's items (Principle VI, FR-038). Failing to
    // drop it is not a failure of the removal.
    try {
      await deps.cache.forgetRepository(args.id);
    } catch {
      // The tree is disposable by definition; the next `clear()` collects it.
    }

    await deps.reconciler.reload();
    return ok(undefined);
  };

  const setCredential = async (args: {
    providerId: string;
    secret: string;
  }): Promise<Result<void>> => {
    // The secret goes in and stops here. `stored` carries no plaintext in either
    // branch: the store never interpolates a credential into a message (rule 3).
    const stored = await deps.secrets.set(args.providerId, args.secret);
    if (!stored.ok) return stored;

    // Providers receive their credential at construction, so a newly configured
    // provider needs rebuilding before it can read anything.
    await deps.reconciler.reload();
    await deps.reconciler.refresh({});
    return ok(undefined);
  };

  const channels: RegisteredChannel[] = [
    {
      channel: CHANNELS.listPackages,
      invoke: validated(
        CHANNELS.listPackages,
        noArgsSchema,
        listPackagesReplySchema,
        listPackages,
        invalidRequestEmpty<SdlcPackageSummary>,
      ),
    },
    {
      channel: CHANNELS.packageSearchPaths,
      invoke: validated(
        CHANNELS.packageSearchPaths,
        noArgsSchema,
        packageSearchPathsReplySchema,
        packageSearchPaths,
        invalidRequestEmpty<string>,
      ),
    },
    {
      channel: CHANNELS.listRepositories,
      invoke: validated(
        CHANNELS.listRepositories,
        noArgsSchema,
        listRepositoriesReplySchema,
        listRepositories,
        invalidRequestEmpty<Repository>,
      ),
    },
    {
      channel: CHANNELS.registerRepository,
      invoke: validated(
        CHANNELS.registerRepository,
        registerRepositoryInputSchema,
        repositoryResultSchema,
        registerRepository,
        invalidRequestResult<Repository>,
      ),
    },
    {
      channel: CHANNELS.updateRepositoryConfig,
      invoke: validated(
        CHANNELS.updateRepositoryConfig,
        updateConfigArgSchema,
        repositoryResultSchema,
        updateRepositoryConfig,
        invalidRequestResult<Repository>,
      ),
    },
    {
      channel: CHANNELS.removeRepository,
      invoke: validated(
        CHANNELS.removeRepository,
        removeRepositoryArgSchema,
        voidResultSchema,
        removeRepository,
        invalidRequestResult<void>,
      ),
    },
    {
      channel: CHANNELS.setCredential,
      invoke: validated(
        CHANNELS.setCredential,
        setCredentialArgSchema,
        // Nothing comes back but success or a typed failure. No secret, ever.
        voidResultSchema,
        setCredential,
        invalidRequestResult<void>,
      ),
    },
  ];

  return {
    listPackages,
    packageSearchPaths,
    listRepositories,
    registerRepository,
    updateRepositoryConfig,
    removeRepository,
    setCredential,
    channels,
  };
}

// ── Package projection ───────────────────────────────────────────────────────

export function toPackageSummary(pkg: SdlcPackage): SdlcPackageSummary {
  const definition = pkg.definition;
  return {
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    path: pkg.path,
    // Distinguished from the package's own version (FR-047).
    contractVersion: pkg.contractVersion,
    supported: definition !== null,
    // Names what is missing, for an unsupported package (FR-045).
    problem: pkg.problem?.message ?? null,
    problemField: pkg.problem?.field ?? null,
    problemLine: pkg.problem?.line ?? null,
    stateCount: definition?.states.length ?? 0,
    // 004. Counted from the loaded definition, never stored, so correcting a
    // manifest clears whatever the view was saying about it on the next
    // reconciliation and nothing here has to be invalidated (FR-013).
    terminalStateCount: (definition?.states ?? []).filter((state) => state.terminal).length,
    unit: definition?.items.unit ?? DEFAULT_UNIT,
    repoConfig: (definition?.repoConfig ?? []).map((field) => ({
      key: field.key,
      title: field.title,
      type: field.type,
      required: field.required,
      default: field.default,
      description: field.description,
    })),
    // Which providers this lifecycle requires, so the view can say which of them
    // are not yet configured (FR-026, FR-035).
    providerKinds: (definition?.providers ?? []).map((provider) => provider.kind),
  };
}

/** FR-045: a package with no usable manifest is refused by name, never guessed at. */
function requireUsablePackage(pkg: SdlcPackage): Result<{ repoConfig: readonly ConfigField[] }> {
  if (pkg.definition !== null) return ok({ repoConfig: pkg.definition.repoConfig });
  const detail =
    pkg.problem?.message ??
    `The '${pkg.id}' package at ${pkg.path} carries no readable lifecycle manifest.`;
  return fail(
    'invalid_input',
    `${detail} A repository cannot be associated with a package whose lifecycle is not declared; ` +
      'its states are not guessed from its skills or documentation.',
    pkg.problem?.field === undefined ? { field: 'packageId' } : { field: pkg.problem.field },
  );
}

// ── Configuration validation ─────────────────────────────────────────────────

/**
 * Validates a repository's supplied values against the package's `repo_config`
 * declarations (FR-024, FR-025).
 *
 * What is checked here is the **values**. That every declared key resolves to a
 * real path in the manifest, and that any gate it targets is `configurable: true`,
 * was already established at manifest load (validation rule 12) — re-checking it
 * would be duplicating the loader's job in a place that cannot report a line
 * number.
 *
 * An undeclared key is rejected rather than stored. The alternative — accepting
 * it quietly — would let a caller write provider settings the package never
 * offered as configurable, and would leave a typo in a key silently ineffective
 * instead of reported.
 */
export function validateRepositoryConfig(
  declared: readonly ConfigField[],
  config: Readonly<Record<string, unknown>>,
): Result<Record<string, unknown>> {
  const byKey = new Map(declared.map((field) => [field.key, field]));

  for (const key of Object.keys(config)) {
    if (byKey.has(key)) continue;
    return fail(
      'invalid_input',
      `"${key}" is not a setting this SDLC package declares. The settings it accepts are: ` +
        `${declared.length === 0 ? 'none' : declared.map((field) => field.key).join(', ')}.`,
      { field: key },
    );
  }

  for (const field of declared) {
    const value = config[field.key];

    if (value === undefined || value === null || value === '') {
      if (field.required && field.default === undefined) {
        return fail(
          'invalid_input',
          `"${field.title}" is required by this SDLC package and was not supplied.`,
          { field: field.key },
        );
      }
      continue;
    }

    const problem = typeProblem(field, value);
    if (problem !== null) {
      return fail('invalid_input', problem, { field: field.key });
    }
  }

  return ok({ ...config });
}

function typeProblem(field: ConfigField, value: unknown): string | null {
  switch (field.type) {
    case 'string':
      return typeof value === 'string'
        ? null
        : `"${field.title}" must be text; ${describeType(value)} was supplied.`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `"${field.title}" must be a number; ${describeType(value)} was supplied.`;
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `"${field.title}" must be true or false; ${describeType(value)} was supplied.`;
    default:
      return null;
  }
}

/** Describes the shape of a rejected value. Never its content, which may be a secret. */
function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  if (value === null) return 'nothing';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}
