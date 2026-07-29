/**
 * Thin LocalAdapter facade for web/dev-mock (#328).
 *
 * Real vault-index sync / watcher / SQLite live only in
 * `createServiceDomainRuntime` (service host). Desktop UI uses IPC.
 * Non-mock in-process calls throw (#171).
 */

import type { ItemFile, VaultMeta } from "@collector/shared";
import type { MediaFileMeta, Tag } from "@collector/shared";
import type { ImportDroppedFilesInput, ImportDroppedFilesResult } from "@collector/api";
import {
  DASHBOARD_PREFETCH_SIZE,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type DashboardItemSort,
  type IndexQueryResult,
  type VaultIndexSyncStatus,
} from "@collector/api";
import { createVaultIndexSyncStatusStore } from "@collector/service";
import type {
  FolderTreeNode,
  MediaWithPath,
  TagWithCount,
} from "@collector/core";
import type { CreateItemInput, UpdateItemInput } from "../types/item";
import type { NavFilter } from "../types/ui";
import { isDevMock } from "../dev/is-dev-mock";
import * as devMockCollector from "../dev/mock-collector";

export type { VaultIndexSyncStatus, DashboardIndexPage, DashboardItemIdsResult };
export { DASHBOARD_PREFETCH_SIZE };

const UI_INPROCESS_SQLITE_REMOVED =
  "UI in-process SQLite removed (#171); use service IPC (default COLLECTOR_SERVICE_MODE)";

const vaultIndexSyncStatusStore = createVaultIndexSyncStatusStore();

function refuseInProcess(): never {
  throw new Error(UI_INPROCESS_SQLITE_REMOVED);
}

function refuseUnlessDevMock(): void {
  if (!isDevMock()) {
    refuseInProcess();
  }
}

/** Idle stub — real progress comes from the host over IPC (#163 / #329). */
export function subscribeVaultIndexSyncStatus(
  onUpdate: (status: VaultIndexSyncStatus) => void,
): () => void {
  return vaultIndexSyncStatusStore.subscribe(onUpdate);
}

export function getVaultIndexSyncStatus(): VaultIndexSyncStatus {
  return vaultIndexSyncStatusStore.get();
}

export async function openCollectorDatabase(): Promise<void> {
  if (isDevMock()) {
    return devMockCollector.warmupCollector();
  }
  refuseInProcess();
}

export async function ensureCollectorDatabaseHealthy(): Promise<void> {
  if (isDevMock()) {
    return;
  }
  refuseInProcess();
}

export async function ensureActiveVault(): Promise<{
  vault: VaultMeta;
  path: string;
}> {
  refuseUnlessDevMock();
  return devMockCollector.ensureActiveVault();
}

export async function getDataDirectory(): Promise<string> {
  refuseUnlessDevMock();
  return "/dev-mock/data";
}

export async function listItems(): Promise<ItemFile[]> {
  refuseInProcess();
}

export async function searchItems(
  _query: string,
  _filter: NavFilter,
): Promise<ItemFile[]> {
  refuseInProcess();
}

export async function fetchDashboardIndexPage(
  filter: NavFilter,
  query = "",
  page: { limit: number; offset: number },
  sort?: DashboardItemSort,
): Promise<DashboardIndexPage> {
  refuseUnlessDevMock();
  return devMockCollector.fetchDashboardIndexPage(filter, query, page, sort);
}

export async function queryIndex(
  filter: NavFilter,
  query: string | undefined,
  page: { limit: number; offset: number },
  sort?: DashboardItemSort,
): Promise<IndexQueryResult> {
  const result = await fetchDashboardIndexPage(filter, query ?? "", page, sort);
  return {
    ids: result.itemIds,
    total: result.totalCount,
    offset: result.offset,
  };
}

export async function* hydrate(
  ids: string[],
  options?: { signal?: AbortSignal },
): AsyncIterable<ItemFile> {
  if (!ids.length || options?.signal?.aborted) {
    return;
  }
  refuseUnlessDevMock();
  const items = await loadDashboardItems(ids, 0, ids.length);
  for (const item of items) {
    if (options?.signal?.aborted) {
      return;
    }
    yield item;
  }
}

export async function listDashboardItemIds(
  filter: NavFilter,
  query = "",
  sort?: DashboardItemSort,
): Promise<DashboardItemIdsResult> {
  refuseUnlessDevMock();
  const page = await fetchDashboardIndexPage(
    filter,
    query,
    {
      limit: DASHBOARD_PREFETCH_SIZE,
      offset: 0,
    },
    sort,
  );
  return {
    itemIds: page.itemIds,
    totalCount: page.totalCount,
    indexSync: Promise.resolve(),
  };
}

export function subscribeDashboardLoad(
  filter: NavFilter,
  query: string,
  handlers: {
    onIndexPage: (page: DashboardIndexPage) => void;
    getLoadedIdCount?: () => number;
    onLoadComplete?: () => void;
    onError?: (scope: string, error: unknown) => void;
  },
  signal?: AbortSignal,
  sort?: DashboardItemSort,
): void {
  if (!isDevMock()) {
    refuseInProcess();
  }
  void (async () => {
    try {
      if (signal?.aborted) {
        return;
      }
      const page = await devMockCollector.fetchDashboardIndexPage(
        filter,
        query,
        {
          limit: DASHBOARD_PREFETCH_SIZE,
          offset: 0,
        },
        sort,
      );
      if (signal?.aborted) {
        return;
      }
      handlers.onIndexPage(page);
      handlers.onLoadComplete?.();
    } catch (error: unknown) {
      if (!signal?.aborted) {
        handlers.onError?.("dashboard load", error);
      }
    }
  })();
}

export async function streamDashboardItems(
  itemIds: string[],
  offset: number,
  limit: number,
  onItem: (item: ItemFile) => void,
  signal?: AbortSignal,
): Promise<void> {
  refuseUnlessDevMock();
  await devMockCollector.streamDashboardItems(
    itemIds,
    offset,
    limit,
    onItem,
    signal,
  );
}

export async function loadDashboardItems(
  itemIds: string[],
  offset: number,
  limit = DASHBOARD_PREFETCH_SIZE,
): Promise<ItemFile[]> {
  refuseUnlessDevMock();
  return devMockCollector.loadDashboardItems(itemIds, offset, limit);
}

export async function getItemById(
  itemId: string,
): Promise<{ item: ItemFile; content: string | null }> {
  refuseUnlessDevMock();
  return devMockCollector.getItemById(itemId);
}

export async function getAdjacentItems(itemId: string) {
  refuseUnlessDevMock();
  return devMockCollector.getAdjacentItems(itemId);
}

export async function getItemSource(itemId: string): Promise<string> {
  refuseUnlessDevMock();
  return devMockCollector.getItemSource(itemId);
}

export async function updateItemSource(
  itemId: string,
  rawMarkdown: string,
): Promise<ItemFile> {
  refuseUnlessDevMock();
  return devMockCollector.updateItemSource(itemId, rawMarkdown);
}

export async function createItem(_input: CreateItemInput): Promise<ItemFile> {
  refuseInProcess();
}

export async function importDroppedFiles(
  _input: ImportDroppedFilesInput,
): Promise<ImportDroppedFilesResult> {
  refuseInProcess();
}

export async function updateItem(
  itemId: string,
  input: UpdateItemInput,
): Promise<ItemFile> {
  refuseUnlessDevMock();
  return devMockCollector.updateItem(itemId, input);
}

export async function deleteItem(_itemId: string): Promise<void> {
  refuseInProcess();
}

export async function listVaults(): Promise<VaultMeta[]> {
  refuseUnlessDevMock();
  const { vault } = await devMockCollector.ensureActiveVault();
  return [vault];
}

export async function getActiveVaultMeta(): Promise<VaultMeta> {
  refuseUnlessDevMock();
  const { vault } = await devMockCollector.ensureActiveVault();
  return vault;
}

export async function switchVault(_vaultId: string): Promise<VaultMeta> {
  refuseInProcess();
}

export async function setDefaultVault(_vaultId: string): Promise<void> {
  refuseInProcess();
}

export function subscribeTags(
  onUpdate: (tags: TagWithCount[]) => void,
  handlers?: {
    onError?: (scope: string, error: unknown) => void;
  },
  _signal?: AbortSignal,
): void {
  if (!isDevMock()) {
    refuseInProcess();
  }
  void devMockCollector
    .listTags()
    .then(onUpdate)
    .catch((error: unknown) => {
      handlers?.onError?.("tags", error);
      onUpdate([]);
    });
}

export async function listTags(): Promise<TagWithCount[]> {
  refuseUnlessDevMock();
  return devMockCollector.listTags();
}

export async function createTag(_input: {
  name: string;
  color?: string | null;
}): Promise<Tag> {
  refuseInProcess();
}

export async function updateTagRecord(
  _tagId: string,
  _input: { name?: string; color?: string | null },
): Promise<Tag> {
  refuseInProcess();
}

export async function deleteTag(_tagId: string): Promise<void> {
  refuseInProcess();
}

export function subscribeFolderTree(
  onUpdate: (tree: FolderTreeNode[]) => void,
  handlers?: {
    onError?: (scope: string, error: unknown) => void;
  },
  _signal?: AbortSignal,
): void {
  if (!isDevMock()) {
    refuseInProcess();
  }
  void devMockCollector
    .listFolderTree()
    .then(onUpdate)
    .catch((error: unknown) => {
      handlers?.onError?.("folder tree", error);
      onUpdate([]);
    });
}

export async function loadFolderTree(): Promise<FolderTreeNode[]> {
  refuseUnlessDevMock();
  return devMockCollector.listFolderTree();
}

export async function listFolderTree(): Promise<FolderTreeNode[]> {
  refuseUnlessDevMock();
  return devMockCollector.listFolderTree();
}

export async function createFolder(_folderPath: string): Promise<string> {
  refuseInProcess();
}

export async function renameFolder(
  _oldPath: string,
  _newPath: string,
): Promise<string> {
  refuseInProcess();
}

export async function deleteFolder(_folderPath: string): Promise<void> {
  refuseInProcess();
}

export async function moveItemToFolderPath(
  _itemId: string,
  _folderPath: string,
): Promise<ItemFile> {
  refuseInProcess();
}

export async function listItemMedia(itemId: string): Promise<MediaWithPath[]> {
  refuseUnlessDevMock();
  return devMockCollector.listItemMedia(itemId);
}

export async function resolveItemThumbnailPath(
  item: ItemFile,
): Promise<string | null> {
  refuseUnlessDevMock();
  return devMockCollector.resolveItemThumbnailPath(item);
}

export async function resolveItemThumbnailPaths(
  items: ItemFile[],
): Promise<Map<string, string | null>> {
  refuseUnlessDevMock();
  const resolved = new Map<string, string | null>();
  for (const item of items) {
    resolved.set(item.id, await devMockCollector.resolveItemThumbnailPath(item));
  }
  return resolved;
}

export async function setItemCoverFromMedia(
  _itemId: string,
  _mediaId: string,
): Promise<ItemFile> {
  refuseInProcess();
}

export async function attachMediaFiles(
  _itemId: string,
  _files: Array<{ filename: string; data: Uint8Array }>,
): Promise<MediaFileMeta[]> {
  refuseInProcess();
}

export async function replaceItemMedia(
  _itemId: string,
  _mediaId: string,
  _file: { filename: string; data: Uint8Array },
): Promise<MediaFileMeta> {
  refuseInProcess();
}

export async function deleteItemMedia(
  _itemId: string,
  _mediaId: string,
): Promise<void> {
  refuseInProcess();
}
