/**
 * T063 — reconciliation: keeping the observed family in step with the systems of
 * record, without a restart (FR-010).
 *
 * ## Why this module watches nothing itself
 *
 * `chokidar` already lives inside the filesystem provider's `subscribe`, and the
 * interval poll already lives inside the remote providers'. So reconciliation
 * drives providers through `provider.subscribe()` rather than watching files or
 * scheduling polls of its own. That is not tidiness: "watch locally, poll
 * remotely" is a property of the *system being read*, and a reconciler that knew
 * which providers need a watch and which need a tick would have absorbed exactly
 * the provider-specific knowledge Principle IV's parity suite exists to detect.
 *
 * ## Every change emits an invalidation, never a payload
 *
 * A provider signals that something may have changed; this module re-reconciles
 * the affected repository and then emits `{ type: 'items', repositoryId }` on the
 * `ChangeBus`. The renderer re-reads through its query cache. Pushing the new
 * items with the event would save a round trip and would hand the renderer a
 * second source of truth alongside its cache — the divergence Principle VI and
 * Principle XIII both warn about (ipc-surface.md §3).
 *
 * ## Blast radius
 *
 * One repository's reconciliation failing leaves every other repository's items
 * intact, and within a repository one provider failing leaves the other
 * providers' items fresh and correct while its own are marked stale (Principle
 * III, FR-037, SC-007). Nothing in this file throws: a repository that cannot be
 * read reports why and stays listed.
 *
 * No `electron` import, and no module-level mutable state — every piece of state
 * below lives in the closure `createReconciler` returns (Principle VIII).
 */

import type { ProviderId, SdlcDefinition, SdlcPackage } from '@core/model/declared.js';
import type { RefreshScope } from '@core/ipc/schema.js';
import type {
  ItemKey,
  ProviderHealth,
  Repository,
  RepositoryAvailability,
  WorkItem,
} from '@core/model/observed.js';
import { fail, ok, type Result } from '@core/model/result.js';
import type { RepoContext, Unsubscribe } from '@providers/contract.js';

import type { Cache } from '../cache/index.js';
import type { TransitionLog } from '../cache/transitions.js';
import { scanPackages } from '../discovery/scan.js';
import type { ChangeBus } from '../ipc/events.js';
import type { ProviderSet } from '../providers.js';
import type { Registry, RegisteredRepository } from '../registry/index.js';

import { assembleWorkItem, serveFromCache } from './assemble.js';
import { discoverItems, type DiscoveredItem } from './discover.js';

/** Everything the IPC layer needs to know about one registered repository. */
export interface RepositoryState {
  readonly registered: RegisteredRepository;
  /** The IPC-facing record, carrying provider health and never a secret. */
  readonly repository: Repository;
  readonly pkg: SdlcPackage | null;
  readonly definition: SdlcDefinition | null;
  readonly ctx: RepoContext | null;
  readonly providers: ProviderSet | null;
  readonly items: readonly WorkItem[];
}

/** One item, with the repository that gives it a name, an SDLC, and a definition. */
export interface ItemContext {
  readonly item: WorkItem;
  readonly repository: RepositoryState;
}

export interface ReconcileDeps {
  readonly registry: Registry;
  readonly cache: Cache;
  readonly transitions: TransitionLog;
  readonly bus: ChangeBus;
  readonly packageRoots: readonly string[];
  /** Injected so a test can supply packages without a filesystem scan. */
  readonly scan?: (roots: readonly string[]) => Promise<SdlcPackage[]>;
  /** Builds the adapters for one repository. The composition root binds credentials here. */
  readonly providersFor: (
    definition: SdlcDefinition,
    config: Readonly<Record<string, unknown>>,
  ) => Promise<ProviderSet>;
  readonly now?: () => Date;
  /** A burst of provider notifications costs one reconciliation, not one each. */
  readonly debounceMs?: number;
}

export interface Reconciler {
  /** Loads registrations and packages, reconciles everything, and subscribes. */
  start(): Promise<void>;
  /** Re-reads registrations and packages, then reconciles. Emits `repositories`. */
  reload(): Promise<void>;
  /** FR-010's explicit path, for the retry a failed provider offers (Principle X). */
  refresh(scope: RefreshScope): Promise<Result<void>>;
  repositories(): readonly RepositoryState[];
  packages(): readonly SdlcPackage[];
  items(): readonly ItemContext[];
  find(key: ItemKey): ItemContext | undefined;
  /** One item with **every** state's gates evaluated, for the detail view (FR-014). */
  detail(key: ItemKey): Promise<Result<ItemContext>>;
  /** Releases every watcher, poll timer, and debounce. */
  dispose(): Promise<void>;
}

interface LoadedRepository {
  registered: RegisteredRepository;
  repository: Repository;
  pkg: SdlcPackage | null;
  definition: SdlcDefinition | null;
  ctx: RepoContext | null;
  providers: ProviderSet | null;
  items: WorkItem[];
  /** The last cycle's raw accounts, so the detail view can re-evaluate in place. */
  discovered: Map<ItemKey, DiscoveredItem>;
  subscriptions: Unsubscribe[];
  /** Serialises reconciliations of one repository; a burst must not interleave. */
  running: Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 250;

export function createReconciler(deps: ReconcileDeps): Reconciler {
  const scan = deps.scan ?? scanPackages;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  // Closure state, never module state (Principle VIII): two reconcilers over two
  // user-data directories must not share anything.
  const loaded = new Map<string, LoadedRepository>();
  let packages: SdlcPackage[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastHealth = new Map<string, ProviderHealth['status']>();
  let disposed = false;

  // ── Loading ────────────────────────────────────────────────────────────────

  const packageFor = (packageId: string): SdlcPackage | null =>
    packages.find((candidate) => candidate.id === packageId) ?? null;

  const describeUnsupported = (registered: RegisteredRepository, pkg: SdlcPackage | null): string => {
    if (pkg === null) {
      return (
        `No SDLC package with id '${registered.packageId}' is installed on this machine, so this ` +
        'repository has no lifecycle to render. Install the package, or re-associate the repository.'
      );
    }
    return (
      pkg.problem?.message ??
      `The '${pkg.id}' package carries no usable lifecycle manifest, so it is unsupported.`
    );
  };

  const buildRepository = async (
    registered: RegisteredRepository,
    pkg: SdlcPackage | null,
    providers: ProviderSet | null,
  ): Promise<Repository> => {
    const supported = pkg !== null && pkg.definition !== null;
    let availability: RepositoryAvailability = 'unsupported_package';
    let problem: string | null = supported ? null : describeUnsupported(registered, pkg);

    if (supported) {
      availability = await deps.registry.availability(registered);
      if (availability === 'path_missing') {
        problem =
          `${registered.path} no longer exists or is not a directory. The registration is kept so ` +
          'it can be re-pointed or removed; nothing was deleted.';
      }
    }

    // Carries providerStatus, never secrets (ipc-surface.md rule 3).
    const providerStatus = providers === null ? {} : await providers.health();

    return {
      id: registered.id,
      name: registered.name,
      path: registered.path,
      packageId: registered.packageId,
      // What the registration recorded, which may differ from the installed
      // package's version after an upgrade (FR-043, FR-046).
      packageVersion: registered.packageVersion,
      config: { ...registered.config },
      providerStatus,
      availability,
      problem,
    };
  };

  const emitHealthChanges = (
    repositoryId: string,
    providerStatus: Readonly<Record<ProviderId, ProviderHealth>>,
  ): void => {
    for (const [providerId, health] of Object.entries(providerStatus)) {
      const key = `${repositoryId}:${providerId}`;
      if (lastHealth.get(key) === health.status) continue;
      lastHealth.set(key, health.status);
      deps.bus.emit({ type: 'providerHealth', providerId, health });
    }
  };

  const load = async (registered: RegisteredRepository): Promise<LoadedRepository> => {
    const pkg = packageFor(registered.packageId);
    const definition = pkg?.definition ?? null;

    let providers: ProviderSet | null = null;
    let ctx: RepoContext | null = null;
    if (definition !== null) {
      providers = await deps.providersFor(definition, registered.config);
      ctx = {
        repositoryId: registered.id,
        repositoryPath: registered.path,
        definition,
        // Passed through unchanged: providers read `gates.<id>.<prop>` overrides
        // from here and honour them only for a gate declaring `configurable: true`.
        config: { ...registered.config },
      };
    }

    const repository = await buildRepository(registered, pkg, providers);
    emitHealthChanges(registered.id, repository.providerStatus);

    // Until the first reconciliation lands, the last reconciled data is what the
    // interface shows — marked stale, because that is what it is (FR-002, FR-038).
    const cached = (await deps.cache.readItems(registered.id)).map(serveFromCache);

    return {
      registered,
      repository,
      pkg,
      definition,
      ctx,
      providers,
      items: cached,
      discovered: new Map(),
      subscriptions: [],
      running: Promise.resolve(),
    };
  };

  const unsubscribe = (entry: LoadedRepository): void => {
    for (const stop of entry.subscriptions) {
      try {
        stop();
      } catch {
        // A watcher that fails to close must not stop the others closing.
      }
    }
    entry.subscriptions = [];
  };

  const subscribe = (entry: LoadedRepository): void => {
    unsubscribe(entry);
    const { ctx, providers, definition } = entry;
    if (ctx === null || providers === null || definition === null) return;

    for (const providerId of providers.declared) {
      const provider = providers.get(providerId);
      if (provider === undefined) continue;
      try {
        // Watch locally, poll remotely — the provider decides which, because the
        // provider is what knows (provider-interface.md §1).
        entry.subscriptions.push(provider.subscribe(ctx, () => scheduleReconcile(entry.registered.id)));
      } catch {
        // A provider that cannot subscribe simply does not push; the explicit
        // `refresh` path still works, which is the retry Principle X requires.
      }
    }
  };

  const scheduleReconcile = (repositoryId: string): void => {
    if (disposed) return;
    const existing = timers.get(repositoryId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(repositoryId);
      void reconcileRepository(repositoryId);
    }, debounceMs);
    // A pending reconciliation must not hold the process open.
    timer.unref?.();
    timers.set(repositoryId, timer);
  };

  // ── Reconciling ────────────────────────────────────────────────────────────

  const reconcileNow = async (entry: LoadedRepository): Promise<void> => {
    const { ctx, providers, definition, pkg } = entry;

    if (ctx === null || providers === null || definition === null || pkg === null) {
      // No lifecycle to reconcile against. Whatever was cached stays visible,
      // marked stale, rather than the repository rendering as empty (Principle X).
      entry.items = entry.items.map(serveFromCache);
      return;
    }

    if (entry.repository.availability === 'path_missing') {
      entry.items = entry.items.map(serveFromCache);
      return;
    }

    const previous = new Map(entry.items.map((item) => [item.key, item]));
    const lookup = (id: ProviderId) => providers.get(id);
    const discovery = await discoverItems(ctx, lookup);

    const items: WorkItem[] = [];
    const discovered = new Map<ItemKey, DiscoveredItem>();

    for (const candidate of discovery.items) {
      discovered.set(candidate.key, candidate);
      const item = await assembleWorkItem({
        ctx,
        lookup,
        packageId: pkg.id,
        packageVersion: entry.registered.packageVersion,
        discovered: candidate,
        failures: discovery.failures,
        cached: previous.get(candidate.key),
        now: deps.now,
      });
      items.push(item);
    }

    // An item a *failing* provider would have supplied is kept from the last
    // reconciled data and marked stale, rather than vanishing from the list
    // (FR-037, spec §Edge Cases). With every provider healthy, an item that is no
    // longer discovered has genuinely gone and is dropped.
    if (discovery.failures.length > 0) {
      for (const [key, stale] of previous) {
        if (discovered.has(key)) continue;
        items.push(serveFromCache(stale));
      }
    }

    entry.items = items;
    entry.discovered = discovered;

    // FR-032: a durable, inspectable local record of what changed and why. Never
    // written back to a system of record in v1.0 (FR-033, FR-034).
    for (const item of items) {
      if (item.freshness === 'stale') continue;
      try {
        await deps.transitions.recordIfChanged(
          entry.registered.id,
          previous.get(item.key),
          item,
          definition.ownership.state,
        );
      } catch {
        // The log is a record, not a gate. Failing to append must not fail the
        // reconciliation that produced the item.
      }
    }

    try {
      await deps.cache.writeItems(entry.registered.id, items);
    } catch {
      // The cache is non-authoritative and rebuildable (Principle VI): failing to
      // write it costs a re-read next launch, nothing more.
    }

    const repository = await buildRepository(entry.registered, pkg, providers);
    entry.repository = repository;
    emitHealthChanges(entry.registered.id, repository.providerStatus);
  };

  const reconcileRepository = async (repositoryId: string): Promise<void> => {
    const entry = loaded.get(repositoryId);
    if (entry === undefined || disposed) return;

    // Chained rather than concurrent: two overlapping reconciliations of one
    // repository would race on `entry.items` and could persist the older result.
    entry.running = entry.running.then(async () => {
      if (disposed) return;
      try {
        await reconcileNow(entry);
      } catch {
        // Nothing in reconcileNow is written to throw. If something does, this
        // repository keeps its previous items rather than taking down the rest.
      }
      deps.bus.emit({ type: 'items', repositoryId });
    });
    return entry.running;
  };

  const reconcileAll = async (): Promise<void> => {
    // Repositories reconcile independently, so one slow or failing provider does
    // not delay another repository's items (Principle III).
    await Promise.all([...loaded.keys()].map((id) => reconcileRepository(id)));
  };

  const reload = async (): Promise<void> => {
    packages = await scan(deps.packageRoots);
    const registrations = await deps.registry.list();
    const wanted = new Set(registrations.map((registered) => registered.id));

    for (const [id, entry] of loaded) {
      if (wanted.has(id)) continue;
      unsubscribe(entry);
      loaded.delete(id);
    }

    for (const registered of registrations) {
      const existing = loaded.get(registered.id);
      if (existing !== undefined) unsubscribe(existing);
      const entry = await load(registered);
      // A repository that was already loaded keeps whatever it had reconciled, so
      // a registration edit does not blank the list until the next cycle.
      if (existing !== undefined && existing.items.length > 0 && entry.items.length === 0) {
        entry.items = existing.items.map(serveFromCache);
      }
      loaded.set(registered.id, entry);
      subscribe(entry);
    }

    deps.bus.emit({ type: 'repositories' });
  };

  // ── The surface ────────────────────────────────────────────────────────────

  const states = (): RepositoryState[] =>
    [...loaded.values()].map((entry) => ({
      registered: entry.registered,
      repository: entry.repository,
      pkg: entry.pkg,
      definition: entry.definition,
      ctx: entry.ctx,
      providers: entry.providers,
      items: entry.items,
    }));

  const contexts = (): ItemContext[] => {
    const all: ItemContext[] = [];
    for (const state of states()) {
      for (const item of state.items) all.push({ item, repository: state });
    }
    return all;
  };

  return {
    async start(): Promise<void> {
      await reload();
      await reconcileAll();
    },

    reload,

    async refresh(scope: RefreshScope): Promise<Result<void>> {
      if (disposed) {
        return fail('unavailable', 'The application is shutting down; nothing was refreshed.');
      }

      if (scope.itemKey !== undefined) {
        const found = contexts().find((entry) => entry.item.key === scope.itemKey);
        if (found === undefined) {
          return fail('not_found', `No item with key "${scope.itemKey}" is currently listed.`, {
            field: 'itemKey',
          });
        }
        await reconcileRepository(found.repository.repository.id);
        deps.bus.emit({ type: 'item', key: scope.itemKey });
        return ok(undefined);
      }

      if (scope.repositoryId !== undefined) {
        if (!loaded.has(scope.repositoryId)) {
          return fail('not_found', `No repository is registered with id ${scope.repositoryId}.`, {
            field: 'repositoryId',
          });
        }
        await reconcileRepository(scope.repositoryId);
        return ok(undefined);
      }

      // An unscoped refresh re-reads the installed packages too: a package
      // upgraded on disk while the app was open must be picked up without a
      // restart (FR-010, FR-046).
      await reload();
      await reconcileAll();
      return ok(undefined);
    },

    repositories: states,

    packages: () => packages,

    items: contexts,

    find(key: ItemKey): ItemContext | undefined {
      return contexts().find((entry) => entry.item.key === key);
    },

    async detail(key: ItemKey): Promise<Result<ItemContext>> {
      const found = contexts().find((entry) => entry.item.key === key);
      if (found === undefined) {
        return fail(
          'not_found',
          `No item with key "${key}" is currently listed. It may have been completed, ` +
            'reassigned, or removed from its repository since the list was read.',
          { field: 'key' },
        );
      }

      const entry = loaded.get(found.repository.repository.id);
      const { ctx, providers, pkg } = found.repository;
      if (entry === undefined || ctx === null || providers === null || pkg === null) {
        // No definition to evaluate against; the item as last reconciled is the
        // honest answer, and the repository's own problem explains why.
        return ok(found);
      }

      const discovered =
        entry.discovered.get(key) ?? discoveredFromItem(found.item, ctx.definition.ownership.state);

      const item = await assembleWorkItem({
        ctx,
        lookup: (id: ProviderId) => providers.get(id),
        packageId: pkg.id,
        packageVersion: entry.registered.packageVersion,
        discovered,
        failures: [],
        cached: found.item,
        now: deps.now,
        // FR-014: the detail view shows every gate every state declares.
        allGates: true,
      });

      return ok({ item, repository: found.repository });
    },

    async dispose(): Promise<void> {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      const pending: Promise<void>[] = [];
      for (const entry of loaded.values()) {
        unsubscribe(entry);
        pending.push(entry.running.catch(() => undefined));
      }
      await Promise.all(pending);
      loaded.clear();
    },
  };
}

/**
 * Reconstructs a minimal discovery record from a cached item.
 *
 * Needed when the detail view is opened before the first reconciliation has run —
 * the item is known, but the raw accounts that produced it are not in memory.
 *
 * `rawState` is deliberately **not** carried over. A cached status presented as a
 * discovery result would be reported as `fresh`; omitting it sends the assembler
 * to the owning provider, and falling back to the cache from there is what marks
 * the item `stale` honestly (FR-003, FR-037).
 */
function discoveredFromItem(item: WorkItem, owner: ProviderId): DiscoveredItem {
  return {
    key: item.key,
    contributions: [
      {
        key: item.key,
        title: item.title,
        source: item.sources[0] ?? owner,
        fields: item.fields,
      },
    ],
    sources: item.sources.length > 0 ? item.sources : [owner],
  };
}
