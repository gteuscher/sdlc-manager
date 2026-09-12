/**
 * The renderer's half of the IPC contract.
 *
 * Every reply is parsed here before it reaches a component. The main process
 * validated it on the way out, but its replies carry provider data that was
 * itself untrusted, so the second hop is checked too (ipc-surface.md rule 2,
 * Principle IX). A component therefore never sees an unvalidated shape, and
 * "validate at the boundary, not scattered through components" holds literally.
 */

import type { DashboardBridge } from '@core/ipc/bridge';
import {
  consoleAvailabilityReplySchema,
  conversationReplySchema,
  getArtifactReplySchema,
  getItemReplySchema,
  listItemsReplySchema,
  listPackagesReplySchema,
  packageSearchPathsReplySchema,
  listRepositoriesReplySchema,
  messageResultSchema,
  repositoryResultSchema,
  voidResultSchema,
  type ItemFilter,
  type RefreshScope,
  type RegisterRepositoryInput,
} from '@core/ipc/schema';

/**
 * The bridge is installed by the preload script before any renderer code runs.
 * Its absence is a wiring bug, not a user-facing failure, so it is loud.
 */
function bridge(): DashboardBridge {
  const installed = window.dashboard;
  if (installed === undefined) {
    throw new Error('The dashboard bridge is not available. The preload script did not run.');
  }
  return installed;
}

export async function listPackages() {
  return listPackagesReplySchema.parse(await bridge().listPackages());
}

/** Where discovery looked. Absolute paths, so an empty result can say where. */
export async function packageSearchPaths() {
  return packageSearchPathsReplySchema.parse(await bridge().packageSearchPaths());
}

export async function listRepositories() {
  return listRepositoriesReplySchema.parse(await bridge().listRepositories());
}

export async function listItems(filter?: ItemFilter) {
  return listItemsReplySchema.parse(await bridge().listItems(filter));
}

export async function getItem(key: string) {
  return getItemReplySchema.parse(await bridge().getItem(key));
}

export async function getArtifact(key: string, stateId: string, artifactId: string) {
  return getArtifactReplySchema.parse(await bridge().getArtifact(key, stateId, artifactId));
}

export async function registerRepository(input: RegisterRepositoryInput) {
  return repositoryResultSchema.parse(await bridge().registerRepository(input));
}

export async function updateRepositoryConfig(id: string, config: unknown) {
  return repositoryResultSchema.parse(await bridge().updateRepositoryConfig(id, config));
}

export async function removeRepository(id: string) {
  return voidResultSchema.parse(await bridge().removeRepository(id));
}

/** Passes a secret in. Nothing comes back but success or a typed failure (rule 3). */
export async function setCredential(providerId: string, secret: string) {
  return voidResultSchema.parse(await bridge().setCredential(providerId, secret));
}

export async function refresh(scope: RefreshScope) {
  return voidResultSchema.parse(await bridge().refresh(scope));
}

export async function askConsole(key: string, stateId: string, message: string) {
  return messageResultSchema.parse(await bridge().askConsole(key, stateId, message));
}

export async function getConversation(key: string, stateId: string) {
  return conversationReplySchema.parse(await bridge().getConversation(key, stateId));
}

/** A status report about the console's assistant. Never a credential (rule 3). */
export async function consoleAvailable() {
  return consoleAvailabilityReplySchema.parse(await bridge().consoleAvailable());
}

export function onChanged(callback: Parameters<DashboardBridge['onChanged']>[0]) {
  return bridge().onChanged(callback);
}

/** True when the bridge is present. Lets a test render without one. */
export function bridgeAvailable(): boolean {
  return window.dashboard !== undefined;
}
