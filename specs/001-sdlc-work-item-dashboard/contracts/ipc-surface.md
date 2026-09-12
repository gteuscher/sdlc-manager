# Contract: IPC Surface

**Status**: Draft · **Created**: 2026-09-11 · **Feature**: [spec.md](../spec.md)
**Satisfies**: Constitution Principles I, III, VIII, IX · desktop hardening constraint

The only path between the React renderer and everything else. Exposed by `src/preload` through
`contextBridge`; implemented by handlers in `src/main/ipc`.

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. It
has no filesystem access, no network access, and no Node built-ins. Every capability it has is
listed below — which makes this document the renderer's complete privilege set.

---

## 1. Shape

```ts
interface DashboardBridge {
  // Reads
  listPackages(): Promise<SdlcPackageSummary[]>;
  listRepositories(): Promise<Repository[]>;
  listItems(filter?: ItemFilter): Promise<WorkItemSummary[]>;
  getItem(key: ItemKey): Promise<WorkItemDetail>;
  getArtifact(key: ItemKey, stateId: string, artifactId: string): Promise<ArtifactContent>;

  // Local configuration — never a system of record
  registerRepository(input: RegisterRepositoryInput): Promise<Result<Repository>>;
  updateRepositoryConfig(id: RepositoryId, config: unknown): Promise<Result<Repository>>;
  removeRepository(id: RepositoryId): Promise<Result<void>>;
  setCredential(providerId: ProviderId, secret: string): Promise<Result<void>>;

  // Reconciliation
  refresh(scope: RefreshScope): Promise<Result<void>>;
  onChanged(cb: (e: ChangeEvent) => void): Unsubscribe;

  // Advisory console (Story 5)
  askConsole(key: ItemKey, stateId: string, message: string): Promise<Result<Message>>;
  getConversation(key: ItemKey, stateId: string): Promise<Message[]>;
}
```

## 2. Rules

1. **No method writes to a system of record.** `registerRepository`, `updateRepositoryConfig`, and
   `setCredential` write local application configuration only. FR-034's read-only guarantee is
   structural here as in the provider contract — the capability is absent, not merely unused.

2. **Both directions are validated.** Every payload crossing the bridge is parsed with Zod on
   receipt. The renderer is an untrusted producer to the main process, and the main process's
   replies carry provider data that was itself untrusted (Principle IX). Validating only inbound
   traffic would leave the second hop unchecked.

3. **No credential ever crosses.** `setCredential` passes a secret *in*; nothing returns one. The
   renderer can learn that a provider is unconfigured, never what its credential is. `Repository`
   as returned here carries `providerStatus`, never secrets.

4. **No handle crosses.** Only plain serialisable data — no file handles, no streams, no
   functions. A path string in `ArtifactContent` is for display and is not resolvable by the
   renderer.

5. **Failures are values.** Every fallible call returns `Result`, never a rejected promise carrying
   a stack. A provider failure renders as an in-place error with a retry (FR-019, FR-037, Principle
   X), which requires it to arrive as data.

6. **Content arrives inert.** `ArtifactContent` carries markdown or structured test results as
   text plus provenance. It never carries HTML for injection; the renderer parses markdown to React
   elements. Combined with the sandboxed renderer, an escaped sanitiser has no Node to reach.

## 3. Change events

```ts
type ChangeEvent =
  | { type: 'items';        repositoryId: RepositoryId }
  | { type: 'item';         key: ItemKey }
  | { type: 'repositories' }
  | { type: 'providerHealth'; providerId: ProviderId; health: ProviderHealth };
```

Events are **invalidations, not payloads** — they say what changed, and the renderer re-reads
through the query cache. Pushing data would give the renderer a second source of truth alongside
its cache, which is exactly the divergence Principle VI and Principle XIII both warn about.

This is what satisfies FR-010 without a restart: a `chokidar` watch or a poll tick in main emits an
invalidation, and TanStack Query refetches the affected keys.

## 4. What the renderer cannot do

Stated positively, because the hardening rule is easier to verify as a closed list than as a set of
prohibitions. The renderer cannot: read or write any file; open any network connection; spawn any
process; read any credential; modify any system of record; or reach any Electron or Node API not
named above.

A feature needing a capability outside this list requires a new bridge method with its own
validation and its own review against the hardening constraint — never a widening of renderer
privileges.
