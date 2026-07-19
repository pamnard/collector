/**
 * Tauri ↔ Node host CollectorClient (#170).
 *
 * Transport: `invoke("service_ipc_request")` → Rust Unix-socket client → host.
 * Subscribe/stream helpers are composed from request RPCs (host has no push for them yet).
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  ActiveVaultResult,
  AttachMediaFileInput,
  CollectorServiceApi,
  CreateItemInput,
  DashboardIndexPage,
  DashboardItemIdsResult,
  FolderTreeNode,
  GetItemResult,
  MediaWithPath,
  TagWithCount,
  UpdateItemInput,
  VaultIndexSyncStatus,
} from "@collector/api";
import { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
import type {
  AppSettings,
  DashboardSnapshot,
  ItemFile,
  MediaFileMeta,
  Tag,
  VaultMeta,
} from "@collector/shared";
import { navFilterToSetting } from "@collector/core";
import type { NavSearchFilter } from "@collector/core";

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  return invoke<T>("service_ipc_request", {
    method,
    params: params ?? null,
  });
}

export function createTauriIpcAdapter(): CollectorServiceApi {
  let settingsCache: AppSettings | null = null;
  let syncStatusCache: VaultIndexSyncStatus = {
    vaultId: null,
    status: "idle",
    progress: null,
    metadataReady: true,
    ftsReady: true,
  };

  return {
    openCollectorDatabase: () => rpc("openCollectorDatabase"),
    ensureCollectorDatabaseHealthy: () => rpc("ensureCollectorDatabaseHealthy"),
    ensureActiveVault: () => rpc<ActiveVaultResult>("ensureActiveVault"),
    getDataDirectory: () => rpc<string>("getDataDirectory"),

    listItems: () => rpc<ItemFile[]>("listItems"),
    searchItems: (query, filter) =>
      rpc<ItemFile[]>("searchItems", { query, filter }),
    fetchDashboardIndexPage: (filter, query, page) =>
      rpc<DashboardIndexPage>("fetchDashboardIndexPage", {
        filter,
        query,
        page,
      }),
    listDashboardItemIds: async (filter, query) => {
      const result = await rpc<{ itemIds: string[]; totalCount: number }>(
        "listDashboardItemIds",
        { filter, query },
      );
      return {
        itemIds: result.itemIds,
        totalCount: result.totalCount,
        indexSync: Promise.resolve(),
      } satisfies DashboardItemIdsResult;
    },
    subscribeDashboardLoad: (filter, query, handlers, signal) => {
      void (async () => {
        try {
          if (signal?.aborted) return;
          const page = await rpc<DashboardIndexPage>("fetchDashboardIndexPage", {
            filter,
            query,
            page: { limit: DASHBOARD_PREFETCH_SIZE, offset: 0 },
          });
          if (signal?.aborted) return;
          handlers.onIndexPage(page);
          handlers.onLoadComplete?.();
        } catch (error: unknown) {
          if (!signal?.aborted) {
            handlers.onError?.("dashboard load", error);
          }
        }
      })();
    },
    streamDashboardItems: async (itemIds, offset, limit, onItem, signal) => {
      const items = await rpc<ItemFile[]>("loadDashboardItems", {
        itemIds,
        offset,
        limit,
      });
      for (const item of items) {
        if (signal?.aborted) return;
        onItem(item);
      }
    },
    loadDashboardItems: (itemIds, offset, limit) =>
      rpc<ItemFile[]>("loadDashboardItems", { itemIds, offset, limit }),
    getItemById: (itemId) => rpc<GetItemResult>("getItemById", { itemId }),
    getItemSource: (itemId) => rpc<string>("getItemSource", { itemId }),
    updateItemSource: (itemId, rawMarkdown) =>
      rpc<ItemFile>("updateItemSource", { itemId, rawMarkdown }),
    createItem: (input) =>
      rpc<ItemFile>("createItem", input as CreateItemInput),
    updateItem: (itemId, input) =>
      rpc<ItemFile>("updateItem", { itemId, input: input as UpdateItemInput }),
    deleteItem: async (itemId) => {
      await rpc("deleteItem", { itemId });
    },

    subscribeTags: (onUpdate, handlers, signal) => {
      void (async () => {
        try {
          if (signal?.aborted) return;
          onUpdate(await rpc<TagWithCount[]>("listTags"));
        } catch (error: unknown) {
          if (!signal?.aborted) {
            handlers?.onError?.("tags", error);
          }
        }
      })();
    },
    listTags: () => rpc<TagWithCount[]>("listTags"),
    createTag: (input) => rpc<Tag>("createTag", input),
    updateTagRecord: (tagId, input) =>
      rpc<Tag>("updateTagRecord", { tagId, input }),
    deleteTag: async (tagId) => {
      await rpc("deleteTag", { tagId });
    },

    subscribeFolderTree: (onUpdate, handlers, signal) => {
      void (async () => {
        try {
          if (signal?.aborted) return;
          onUpdate(await rpc<FolderTreeNode[]>("listFolderTree"));
        } catch (error: unknown) {
          if (!signal?.aborted) {
            handlers?.onError?.("folder tree", error);
          }
        }
      })();
    },
    listFolderTree: () => rpc<FolderTreeNode[]>("listFolderTree"),
    loadFolderTree: () => rpc<FolderTreeNode[]>("loadFolderTree"),
    createFolder: (folderPath) => rpc<string>("createFolder", { folderPath }),
    renameFolder: (oldPath, newPath) =>
      rpc<string>("renameFolder", { oldPath, newPath }),
    deleteFolder: async (folderPath) => {
      await rpc("deleteFolder", { folderPath });
    },
    moveItemToFolderPath: (itemId, folderPath) =>
      rpc<ItemFile>("moveItemToFolderPath", { itemId, folderPath }),

    listItemMedia: (itemId) =>
      rpc<MediaWithPath[]>("listItemMedia", { itemId }),
    resolveItemThumbnailPath: (item) =>
      rpc<string | null>("resolveItemThumbnailPath", { item }),
    resolveItemThumbnailPaths: async (items) => {
      const record = await rpc<Record<string, string | null>>(
        "resolveItemThumbnailPaths",
        { items },
      );
      return new Map(Object.entries(record));
    },
    setItemCoverFromMedia: (itemId, mediaId) =>
      rpc<ItemFile>("setItemCoverFromMedia", { itemId, mediaId }),
    attachMediaFiles: (itemId, files) =>
      rpc<MediaFileMeta[]>("attachMediaFiles", {
        itemId,
        files: files as AttachMediaFileInput[],
      }),
    deleteItemMedia: async (itemId, mediaId) => {
      await rpc("deleteItemMedia", { itemId, mediaId });
    },

    listVaults: () => rpc<VaultMeta[]>("listVaults"),
    getActiveVaultMeta: () => rpc<VaultMeta>("getActiveVaultMeta"),
    switchVault: (vaultId) => rpc<VaultMeta>("switchVault", { vaultId }),
    setDefaultVault: async (vaultId) => {
      await rpc("setDefaultVault", { vaultId });
    },

    subscribeVaultIndexSyncStatus: (onUpdate) => {
      let cancelled = false;
      const tick = async () => {
        while (!cancelled) {
          try {
            syncStatusCache = await rpc<VaultIndexSyncStatus>(
              "getVaultIndexSyncStatus",
            );
            onUpdate(syncStatusCache);
          } catch {
            // keep last cache
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      void tick();
      return () => {
        cancelled = true;
      };
    },
    getVaultIndexSyncStatus: () => syncStatusCache,

    ensureAppSettings: async () => {
      settingsCache = await rpc<AppSettings>("ensureAppSettings");
      return settingsCache;
    },
    getAppSettingsSync: () => settingsCache,
    updateAppSettings: async (patch) => {
      settingsCache = await rpc<AppSettings>("updateAppSettings", { patch });
      return settingsCache;
    },
    subscribeAppSettings: (onUpdate) => {
      let cancelled = false;
      const tick = async () => {
        while (!cancelled) {
          try {
            settingsCache = await rpc<AppSettings>("ensureAppSettings");
            onUpdate(settingsCache);
          } catch {
            // keep last
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      };
      void tick();
      return () => {
        cancelled = true;
      };
    },
    getAppConfigDirectory: () => rpc<string>("getAppConfigDirectory"),

    ensureDashboardSnapshot: () =>
      rpc<DashboardSnapshot | null>("ensureDashboardSnapshot"),
    peekMatchingDashboardSnapshot: (_input) => null,
    persistDashboardSnapshot: async (snapshot) => {
      await rpc("persistDashboardSnapshot", { snapshot });
    },
    clearDashboardSnapshot: async () => {
      await rpc("clearDashboardSnapshot");
    },
    buildDashboardSnapshot: (input) => ({
      schema_version: 1,
      vault_id: input.vaultId,
      nav_filter: navFilterToSetting(input.filter as NavSearchFilter),
      search: input.search,
      item_ids: input.itemIds,
      items: input.items,
      total_count: input.totalCount,
      stream_end_offset: input.streamEndOffset,
      saved_at: new Date().toISOString(),
    }),
  };
}

export async function bootstrapServiceMode(dataDir: string): Promise<string> {
  return invoke<string>("service_mode_bootstrap", { dataDir });
}

export async function isServiceModeEnabled(): Promise<boolean> {
  try {
    return await invoke<boolean>("service_mode_is_enabled");
  } catch {
    return false;
  }
}
