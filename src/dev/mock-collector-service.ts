/**
 * Explicit DevMock CollectorService for web/:1420 and unit tests (#332).
 * Not a production in-process adapter — desktop uses the service host only.
 */

import type { ItemFile, VaultMeta } from "@collector/shared";
import type { MediaFileMeta } from "@collector/shared";
import type {
  AttachMediaFileInput,
  CollectorApiError,
  CollectorService,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
  ImportFolderInput,
  ImportFolderJobSnapshot,
  NavFilter as ApiNavFilter,
  Subscription,
  SyncNowResult,
  SyncPluginsPort,
  ExtractPort,
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
  type DerivedCatchUpStatus,
  type VaultIndexSyncStatus,
} from "@collector/api";
import {
  createDerivedCatchUpStatusStore,
  createVaultIndexSyncStatusStore,
} from "@collector/service";
import type {
  FolderTreeNode,
  TagWithCount,
} from "@collector/core";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import type {
  CreateItemInput as UiCreateItemInput,
  UpdateItemInput as UiUpdateItemInput,
} from "../types/item";
import type { NavFilter as UiNavFilter } from "../types/ui";
import * as mockCollector from "./mock-collector";
import { MOCK_VAULT_ID } from "./mock-data";
import { mockStore } from "./mock-store";
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
  "DevMock CollectorService does not support this operation (#332); use the service host on desktop";

function createDevMockSyncPluginsPort(): SyncPluginsPort {
  return {
    async syncNow(pluginId): Promise<SyncNowResult> {
      if (pluginId !== "mock") {
        throw new Error(`Unknown sync plugin: ${pluginId}`);
      }
      const stamp = new Date().toISOString();
      const slug = stamp.replace(/[:.]/g, "-");
      const itemId = `${INBOX_FOLDER_NAME}/mock-sync-${slug}.md`;
      mockStore.addItem({
        id: itemId,
        vault_id: MOCK_VAULT_ID,
        title: `Mock sync ${stamp}`,
        description: `Imported by mock sync plugin at ${stamp}`,
        url: null,
        content_type: "note",
        source_type: "plugin",
        metadata: {},
        properties: {},
        thumbnail: null,
        tag_ids: [],
        collection_ids: [],
        folder_path: INBOX_FOLDER_NAME,
        content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: stamp,
        updated_at: stamp,
      });
      return { importedCount: 1, itemIds: [itemId] };
    },
  };
}

function createDevMockExtractPort(): ExtractPort {
  return {
    async discoverExtractCandidates() {
      return [];
    },
    async extractItemCandidate(_itemId, candidate) {
      throw new Error(`Unknown extractor: ${candidate.extractorId}`);
    },
  };
}

const vaultIndexSyncStatusStore = createVaultIndexSyncStatusStore();
const derivedCatchUpStatusStore = createDerivedCatchUpStatusStore();

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

function subscribeDerivedCatchUpStatus(
  onUpdate: (status: DerivedCatchUpStatus) => void,
): Subscription {
  return derivedCatchUpStatusStore.subscribe(onUpdate);
}

function getDerivedCatchUpStatus(): DerivedCatchUpStatus {
  return derivedCatchUpStatusStore.get();
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
    stamps: result.stamps,
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
      findSimilarItems: async (_itemId: string, _limit: number) => [],
      resolveContentTextLinks: mockCollector.resolveContentTextLinks,
      listItemBacklinks: mockCollector.listItemBacklinks,
      listItemOutboundLinks: mockCollector.listItemOutboundLinks,
      getItemSource: mockCollector.getItemSource,
      updateItemSource: mockCollector.updateItemSource,
      createItem: async (_input: UiCreateItemInput) => refuseUnsupported(),
      updateItem: (itemId, input) =>
        mockCollector.updateItem(itemId, input as UiUpdateItemInput),
      deleteItem: async (_itemId) => refuseUnsupported(),
      importDroppedFiles: async (_input: ImportDroppedFilesInput) =>
        refuseUnsupported() as Promise<ImportDroppedFilesResult>,
      importFolder: async (_input: ImportFolderInput) =>
        refuseUnsupported() as Promise<{ jobId: string }>,
      getImportFolderJob: async (_jobId: string) =>
        refuseUnsupported() as Promise<ImportFolderJobSnapshot>,
    },
    tags: {
      subscribeTags,
      listTags: mockCollector.listTags,
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
      subscribeDerivedCatchUpStatus,
      getDerivedCatchUpStatus,
      subscribeVaultPresentationChanged: () =>
        subscriptionFromTeardown(() => {}),
    },
    jobs: {
      getJobStats: async () => ({
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        byType: {},
      }),
      subscribeJobPermanentFailure: () => subscriptionFromTeardown(() => {}),
    },
    settings: {
      ensureAppSettings,
      getAppSettingsSync,
      updateAppSettings,
      subscribeAppSettings,
      getAppConfigDirectory,
    },
    credentials: {
      setCredential: async () => refuseUnsupported(),
      getCredential: async () => refuseUnsupported(),
      hasCredential: async () => refuseUnsupported(),
      deleteCredential: async () => refuseUnsupported(),
      getCredentialsAvailability: async () => ({
        available: false,
        reason:
          "DevMock has no OS keychain; use the domain host (desktop / service host)",
      }),
    },
    syncPlugins: createDevMockSyncPluginsPort(),
    extract: createDevMockExtractPort(),
    telegramSync: {
      getTelegramSyncSettings: async () => ({
        enabled: false,
        folder_path: INBOX_FOLDER_NAME,
        bot_username: null,
        last_sync_at: null,
        last_pull_warnings: [],
        sync_interval_ms: 300_000,
      }),
      updateTelegramSyncSettings: async () => refuseUnsupported(),
      validateTelegramBotToken: async () => refuseUnsupported(),
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
