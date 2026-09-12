/**
 * The IPC channel names, alone in their own module with no dependencies.
 *
 * This separation is a build constraint, not tidiness. The preload script runs
 * with `sandbox: true`, where Electron provides a limited `require` for a few
 * built-ins and **nothing else** — a sandboxed preload cannot require a sibling
 * file. If the channel names lived beside the Zod schemas, the bundler would emit
 * a shared chunk, the preload would `require` it, and the bridge would silently
 * fail to install at runtime while every build and type check stayed green.
 *
 * It is also the right shape for a second reason. The preload is the most
 * privileged code the renderer can reach, and it should carry as little as
 * possible (ipc-surface.md §4). Channel names are all it needs; a schema library
 * in there would enlarge the sandboxed surface to no benefit.
 */

export const CHANNELS = {
  listPackages: 'dashboard:listPackages',
  /** Where discovery looked. Absolute paths, never a secret (rule 3). */
  packageSearchPaths: 'dashboard:packageSearchPaths',
  listRepositories: 'dashboard:listRepositories',
  listItems: 'dashboard:listItems',
  getItem: 'dashboard:getItem',
  getArtifact: 'dashboard:getArtifact',
  registerRepository: 'dashboard:registerRepository',
  updateRepositoryConfig: 'dashboard:updateRepositoryConfig',
  removeRepository: 'dashboard:removeRepository',
  setCredential: 'dashboard:setCredential',
  refresh: 'dashboard:refresh',
  askConsole: 'dashboard:askConsole',
  getConversation: 'dashboard:getConversation',
  /** Read-only health for the console's assistant. Carries no secret (rule 3). */
  consoleAvailable: 'dashboard:consoleAvailable',
  /** Main to renderer. Invalidations, never payloads (ipc-surface.md §3). */
  changed: 'dashboard:changed',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];
