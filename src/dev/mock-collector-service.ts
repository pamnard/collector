/**
 * Explicit DevMock CollectorService for web/:1420 and unit tests (#332).
 * Not a production in-process adapter — desktop uses IPC only.
 */

import type { ItemFile, VaultMeta } from "@collector/shared";
import type { MediaFileMeta, Tag } from "@collector/shared";
import type {
  AttachMediaFileInput,
  CollectorApiError,
  CollectorService,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
  NavFilter as ApiNavFilter,
  Subscription,
  UiSession,
} from "@collector/api";
import {
  asCollectorApiError,
  DASHBOARD_PREFETCH_SIZE,
  subscriptionFromTeardown,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type DashboardItemSort,
  type IndexQueryResult,
  type VaultIndexSyncStatus,
} from "@collector/api";
import { createVaultIndexSyncStatusStore } from "@collector/service";
import type {
  FolderTreeNode,
  TagWithCount,
} from "@collector/core";
import type {
  CreateItemInput as UiCreateItemInput,
  UpdateItemInput as UiUpdateItemInput,
} from "../types/item";
import type { NavFilter as UiNavFilter } from "../types/ui";
import * as mockCollector from "./mock-collector";
import {
  ensureAppSettings,
  getAppConfigDirectory,
  getAppSettingsSync,
  subscribeAppSettings,
  updateAppSettings,
} from "../services/app-settings-service";
import { createThumbnailResolveSession } from "../services/thumbnail-resolve-session";
import { createUiDashboardSnapshotPort } from "../services/ui-dashboard-snapshot-port";

const DEV_MOCK_UNSUPPORTED =
  "DevMock CollectorService does not support this operation (#332); use service IPC on desktop";

const vaultIndexSyncStatusStore = createVaultIndexSyncStatusStore();

function asUiNavFilter(filter: ApiNavFilter): UiNavFilter {
  return filter as UiNavFilter;
}

function refuseUnsupported(): never {
  throw new Error(DEV_MOCK_UNSUPPORTED);
}

function subscribeVaultIndexSyncStatus(
  onUpdate: (status: VaultIndexSyncStatus) => void,
): Subscription {
  return vaultIndexSyncStatusStore.subscribe(onUpdate);
}

function getVaultIndexSyncStatus(): VaultIndexSyncStatus {
  return vaultIndexSyncStatusStore.get();
}

async function fetchDashboardIndexPage(
  filter: UiNavFilter,
  query = "",
  page: { limit: number; offset: number },
  sort?: DashboardItemSort,
): Promise<DashboardIndexPage> {
  return mockCollector.fetchDashboardIndexPage(filter, query, page, sort);
}

async function queryIndex(
  filter: UiNavFilter,
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

async function* hydrate(
  ids: string[],
  options?: { signal?: AbortSignal },
): AsyncIterable<ItemFile> {
  if (!ids.length || options?.signal?.aborted) {
    return;
  }
  const items = await mockCollector.loadDashboardItems(ids, 0, ids.length);
  for (const item of items) {
    if (options?.signal?.aborted) {
      return;
    }
    yield item;
  }
}

async function listDashboardItemIds(
  filter: UiNavFilter,
  query = "",
  sort?: DashboardItemSort,
): Promise<DashboardItemIdsResult> {
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
  };
}

function subscribeDashboardLoad(
  filter: UiNavFilter,
  query: string,
  handlers: {
    onIndexPage: (page: DashboardIndexPage) => void;
    getLoadedIdCount?: () => number;
    onLoadComplete?: () => void;
    onError?: (scope: string, error: CollectorApiError) => void;
  },
  signal?: AbortSignal,
  sort?: DashboardItemSort,
): Subscription {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  const active = controller.signal;
  void (async () => {
    try {
      if (active.aborted) {
        return;
      }
      const page = await mockCollector.fetchDashboardIndexPage(
        filter,
        query,
        {
          limit: DASHBOARD_PREFETCH_SIZE,
          offset: 0,
        },
        sort,
      );
      if (active.aborted) {
        return;
      }
      handlers.onIndexPage(page);
      handlers.onLoadComplete?.();
    } catch (error: unknown) {
      if (!active.aborted) {
        handlers.onError?.("dashboard load", asCollectorApiError(error));
      }
    }
  })();
  return subscriptionFromTeardown(() => controller.abort());
}

function subscribeTags(
  onUpdate: (tags: TagWithCount[]) => void,
  handlers?: {
    onError?: (scope: string, error: CollectorApiError) => void;
  },
  signal?: AbortSignal,
): Subscription {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  void mockCollector
    .listTags()
    .then((tags) => {
      if (!controller.signal.aborted) {
        onUpdate(tags);
      }
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        handlers?.onError?.("tags", asCollectorApiError(error));
        onUpdate([]);
      }
    });
  return subscriptionFromTeardown(() => controller.abort());
}

function subscribeFolderTree(
  onUpdate: (tree: FolderTreeNode[]) => void,
  handlers?: {
    onError?: (scope: string, error: CollectorApiError) => void;
  },
  signal?: AbortSignal,
): Subscription {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  void mockCollector
    .listFolderTree()
    .then((tree) => {
      if (!controller.signal.aborted) {
        onUpdate(tree);
      }
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        handlers?.onError?.("folder tree", asCollectorApiError(error));
        onUpdate([]);
      }
    });
  return subscriptionFromTeardown(() => controller.abort());
}

async function resolveItemThumbnailPaths(
  items: ItemFile[],
): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>();
  for (const item of items) {
    resolved.set(item.id, await mockCollector.resolveItemThumbnailPath(item));
  }
  return resolved;
}

/** Domain ports for web DevMock / unit tests (#332). */
export function createDevMockCollectorService(): CollectorService {
  return {
    boot: {
      openCollectorDatabase: () => mockCollector.warmupCollector(),
      ensureCollectorDatabaseHealthy: async () => {},
      ensureActiveVault: () => mockCollector.ensureActiveVault(),
      getDataDirectory: async () => "/dev-mock/data",
    },
    items: {
      searchItems: async (_query, _filter) => refuseUnsupported(),
      queryIndex: (filter, query, page, sort) =>
        queryIndex(asUiNavFilter(filter), query, page, sort),
      hydrate,
      fetchDashboardIndexPage: (filter, query, page, sort) =>
        fetchDashboardIndexPage(asUiNavFilter(filter), query, page, sort),
      listDashboardItemIds: (filter, query, sort) =>
        listDashboardItemIds(asUiNavFilter(filter), query, sort),
      subscribeDashboardLoad: (filter, query, handlers, signal, sort) =>
        subscribeDashboardLoad(
          asUiNavFilter(filter),
          query,
          handlers,
          signal,
          sort,
        ),
      streamDashboardItems: mockCollector.streamDashboardItems,
      loadDashboardItems: mockCollector.loadDashboardItems,
      getItemById: mockCollector.getItemById,
      getAdjacentItems: mockCollector.getAdjacentItems,
      getItemSource: mockCollector.getItemSource,
      updateItemSource: mockCollector.updateItemSource,
      createItem: async (_input: UiCreateItemInput) => refuseUnsupported(),
      updateItem: (itemId, input) =>
        mockCollector.updateItem(itemId, input as UiUpdateItemInput),
      deleteItem: async (_itemId) => refuseUnsupported(),
      importDroppedFiles: async (_input: ImportDroppedFilesInput) =>
        refuseUnsupported() as Promise<ImportDroppedFilesResult>,
    },
    tags: {
      subscribeTags,
      listTags: mockCollector.listTags,
      createTag: async (_input: {
        name: string;
        color?: string | null;
      }): Promise<Tag> => refuseUnsupported(),
      updateTagRecord: async (
        _tagId: string,
        _input: { name?: string; color?: string | null },
      ): Promise<Tag> => refuseUnsupported(),
      deleteTag: async (_tagId: string) => refuseUnsupported(),
    },
    folders: {
      subscribeFolderTree,
      listFolderTree: mockCollector.listFolderTree,
      createFolder: async (_folderPath: string) => refuseUnsupported(),
      renameFolder: async (_oldPath: string, _newPath: string) =>
        refuseUnsupported(),
      deleteFolder: async (_folderPath: string) => refuseUnsupported(),
      moveItemToFolderPath: async (_itemId: string, _folderPath: string) =>
        refuseUnsupported() as Promise<ItemFile>,
    },
    media: {
      listItemMedia: mockCollector.listItemMedia,
      resolveItemThumbnailPath: mockCollector.resolveItemThumbnailPath,
      resolveItemThumbnailPaths,
      setItemCoverFromMedia: async (_itemId: string, _mediaId: string) =>
        refuseUnsupported() as Promise<ItemFile>,
      attachMediaFiles: async (
        _itemId: string,
        _files: AttachMediaFileInput[],
      ): Promise<MediaFileMeta[]> => refuseUnsupported(),
      replaceItemMedia: async (
        _itemId: string,
        _mediaId: string,
        _file: AttachMediaFileInput,
      ): Promise<MediaFileMeta> => refuseUnsupported(),
      deleteItemMedia: async (_itemId: string, _mediaId: string) =>
        refuseUnsupported(),
    },
    vaults: {
      listVaults: async (): Promise<VaultMeta[]> => {
        const { vault } = await mockCollector.ensureActiveVault();
        return [vault];
      },
      getActiveVaultMeta: async (): Promise<VaultMeta> => {
        const { vault } = await mockCollector.ensureActiveVault();
        return vault;
      },
      switchVault: async (_vaultId: string) => refuseUnsupported(),
      setDefaultVault: async (_vaultId: string) => refuseUnsupported(),
    },
    index: {
      subscribeVaultIndexSyncStatus,
      getVaultIndexSyncStatus,
    },
    settings: {
      ensureAppSettings,
      getAppSettingsSync,
      updateAppSettings,
      subscribeAppSettings,
      getAppConfigDirectory,
    },
  };
}

/** UiSession for DevMock (#332 / #368). */
export function createDevMockUiSession(service: CollectorService): UiSession {
  return {
    snapshot: createUiDashboardSnapshotPort(),
    settingsSync: {
      getAppSettingsSync: () => service.settings.getAppSettingsSync(),
    },
    thumbnails: createThumbnailResolveSession({
      resolveActiveVault: () => service.boot.ensureActiveVault(),
    }),
  };
}
