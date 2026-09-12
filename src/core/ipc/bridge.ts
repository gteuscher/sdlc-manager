/**
 * The renderer's complete privilege set (contracts/ipc-surface.md §1).
 *
 * Stated as one type so that preload, the main-process handlers, and the renderer
 * all agree. A feature needing a capability outside this list requires a new
 * method here with its own validation and its own review against the hardening
 * constraint — never a widening of renderer privileges.
 *
 * The renderer cannot: read or write any file; open any network connection; spawn
 * any process; read any credential; modify any system of record; or reach any
 * Electron or Node API not named below (ipc-surface.md §4).
 */

import type {
  ArtifactContent,
  Message,
  ProviderHealth,
  Repository,
  WorkItemDetail,
  WorkItemSummary,
} from '../model/observed.js';
import type { Result } from '../model/result.js';
import type {
  ChangeEvent,
  ItemFilter,
  RefreshScope,
  RegisterRepositoryInput,
  SdlcPackageSummary,
} from './schema.js';

export type Unsubscribe = () => void;

export interface DashboardBridge {
  // ── Reads ────────────────────────────────────────────────────────────────
  listPackages(): Promise<SdlcPackageSummary[]>;
  /**
   * The directories `listPackages` scanned (Principle I, Principle X).
   *
   * Without it, "no SDLC packages were found" is a dead end: it names neither
   * where the application looked nor the environment variable that points it
   * somewhere else, and that is the first thing anyone sees who has not installed
   * a package into one of the three default locations. Absolute paths, no secret.
   */
  packageSearchPaths(): Promise<string[]>;
  listRepositories(): Promise<Repository[]>;
  listItems(filter?: ItemFilter): Promise<WorkItemSummary[]>;
  getItem(key: string): Promise<Result<WorkItemDetail>>;
  getArtifact(key: string, stateId: string, artifactId: string): Promise<Result<ArtifactContent>>;

  // ── Local configuration — never a system of record (rule 1) ──────────────
  registerRepository(input: RegisterRepositoryInput): Promise<Result<Repository>>;
  updateRepositoryConfig(id: string, config: unknown): Promise<Result<Repository>>;
  removeRepository(id: string): Promise<Result<void>>;
  /** Passes a secret *in*. Nothing returns one (rule 3). */
  setCredential(providerId: string, secret: string): Promise<Result<void>>;

  // ── Reconciliation ───────────────────────────────────────────────────────
  refresh(scope: RefreshScope): Promise<Result<void>>;
  onChanged(cb: (event: ChangeEvent) => void): Unsubscribe;

  // ── Advisory console (Story 5) ───────────────────────────────────────────
  askConsole(key: string, stateId: string, message: string): Promise<Result<Message>>;
  getConversation(key: string, stateId: string): Promise<Message[]>;
  /**
   * Whether the console can answer, and if not, what is missing (FR-030).
   *
   * The same read-only health report every other provider already publishes
   * through `Repository.providerStatus`, so it widens no privilege: it names a
   * provider and its status, and carries no credential in either direction
   * (rule 3). It exists because Principle I requires an actionable prompt naming
   * the missing provider *when the view opens* — a console that accepts a
   * question and only then admits it cannot answer is the silent empty state
   * that rule forbids, and the application ships with no assistant configured.
   */
  consoleAvailable(): Promise<ProviderHealth>;
}

declare global {
  interface Window {
    readonly dashboard: DashboardBridge;
  }
}
