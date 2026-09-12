/**
 * Every read the renderer performs, and the one subscription that keeps them
 * current.
 *
 * `useChangeEvents` is the piece that satisfies FR-010: the main process emits an
 * invalidation naming what changed, and the affected keys refetch. No component
 * holds a copy, so there is no second source of truth to diverge (Principle XIII).
 */

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { ChangeEvent, ItemFilter, RegisterRepositoryInput } from '@core/ipc/schema';

import * as bridge from './bridge';
import { queryKeys } from './keys';

export function useItems(filter?: ItemFilter) {
  return useQuery({
    queryKey: queryKeys.items(filter),
    queryFn: () => bridge.listItems(filter),
  });
}

export function useItem(key: string | undefined) {
  return useQuery({
    queryKey: queryKeys.item(key ?? ''),
    queryFn: () => bridge.getItem(key as string),
    enabled: key !== undefined && key !== '',
  });
}

export function useRepositories() {
  return useQuery({
    queryKey: queryKeys.repositories(),
    queryFn: () => bridge.listRepositories(),
  });
}

export function usePackages() {
  return useQuery({
    queryKey: queryKeys.packages(),
    queryFn: () => bridge.listPackages(),
  });
}

/**
 * The directories discovery scanned, so "none found" can say where it looked
 * (Principle I, Principle X).
 *
 * Read alongside `usePackages` rather than only when the list comes back empty:
 * fetching it lazily would put a second round trip between an engineer and the
 * one screen that has nothing else on it.
 */
export function usePackageSearchPaths() {
  return useQuery({
    queryKey: queryKeys.packageSearchPaths(),
    queryFn: () => bridge.packageSearchPaths(),
  });
}

export function useArtifact(key: string, stateId: string, artifactId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.artifact(key, stateId, artifactId ?? ''),
    queryFn: () => bridge.getArtifact(key, stateId, artifactId as string),
    enabled: artifactId !== undefined,
  });
}

/**
 * Whether the console can answer at all, and if not what is missing (FR-030).
 *
 * Asked when a state tab opens rather than when a question is sent, because the
 * application ships with no assistant configured and Principle I requires the
 * missing provider to be named rather than discovered by trying.
 */
export function useConsoleAvailability() {
  return useQuery({
    queryKey: queryKeys.consoleAvailability(),
    queryFn: () => bridge.consoleAvailable(),
  });
}

export function useConversation(key: string, stateId: string) {
  return useQuery({
    queryKey: queryKeys.conversation(key, stateId),
    queryFn: () => bridge.getConversation(key, stateId),
  });
}

export function useRegisterRepository() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterRepositoryInput) => bridge.registerRepository(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.repositories() });
      void client.invalidateQueries({ queryKey: queryKeys.itemsAll() });
    },
  });
}

export function useUpdateRepositoryConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; config: unknown }) => bridge.updateRepositoryConfig(input.id, input.config),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.repositories() });
      void client.invalidateQueries({ queryKey: queryKeys.itemsAll() });
    },
  });
}

export function useRemoveRepository() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => bridge.removeRepository(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.repositories() });
      void client.invalidateQueries({ queryKey: queryKeys.itemsAll() });
    },
  });
}

export function useSetCredential() {
  const client = useQueryClient();
  return useMutation({
    // The secret goes in; nothing comes back but success or a typed failure.
    mutationFn: (input: { providerId: string; secret: string }) => bridge.setCredential(input.providerId, input.secret),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.repositories() });
    },
  });
}

export function useRefresh() {
  return useMutation({
    mutationFn: (scope: { repositoryId?: string; itemKey?: string }) => bridge.refresh(scope),
  });
}

export function useAskConsole(key: string, stateId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => bridge.askConsole(key, stateId, message),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.conversation(key, stateId) });
    },
  });
}

/** Translates one invalidation into the keys it affects. Exported so it can be tested directly. */
export function applyChangeEvent(client: QueryClient, event: ChangeEvent): void {
  switch (event.type) {
    case 'items':
      void client.invalidateQueries({ queryKey: queryKeys.itemsAll() });
      break;
    case 'item':
      void client.invalidateQueries({ queryKey: queryKeys.item(event.key) });
      void client.invalidateQueries({ queryKey: queryKeys.itemsAll() });
      break;
    case 'repositories':
      void client.invalidateQueries({ queryKey: queryKeys.repositories() });
      // The installed packages are rescanned by the same reload that emits this
      // event, so they must be re-read with it. Without this, the first paint —
      // which happens before the initial scan completes — caches an empty
      // package list and never learns better, and the repositories view reports
      // "no packages found" on a machine that has them.
      void client.invalidateQueries({ queryKey: queryKeys.packages() });
      break;
    case 'providerHealth':
      void client.invalidateQueries({ queryKey: queryKeys.repositories() });
      void client.invalidateQueries({ queryKey: queryKeys.itemsAll() });
      // The console's assistant is a provider too, so a console that becomes
      // configured says so without a restart (FR-010).
      void client.invalidateQueries({ queryKey: queryKeys.consoleAvailability() });
      break;
  }
}

/** Subscribes once, for the life of the application. This is FR-010's "without a restart". */
export function useChangeEvents(): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!bridge.bridgeAvailable()) return;
    return bridge.onChanged((event) => {
      applyChangeEvent(client, event);
    });
  }, [client]);
}
