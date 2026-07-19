/**
 * IPC Collector client (#154): mirrors {@link CollectorServiceApi}.
 *
 * Until host domain handlers exist, every method except transport health/ping
 * fails with validation `unimplemented` — no silent defaults / empty results.
 * Browser-safe with injectable transport (#240). Node dialer: `./node`. Production UI stays LocalAdapter until #170.
 */

import type {
  ActiveVaultResult,
  AttachMediaFileInput,
  CollectorServiceApi,
  CreateItemInput,
  DashboardIndexPage,
  DashboardItemIdsResult,
  DashboardLoadHandlers,
  FolderTreeNode,
  GetItemResult,
  MediaWithPath,
  NavFilter,
  ServiceSubscribeHandlers,
  TagWithCount,
  UpdateItemInput,
  VaultIndexSyncStatus,
} from "@collector/api";
import type { AppSettings, DashboardSnapshot, ItemFile, MediaFileMeta, Tag, VaultMeta } from "@collector/shared";
import {
  SERVICE_IPC_EVENTS,
  serviceIpcError,
  type ServiceIpcClient,
  type ServiceIpcHealthResult,
  type ServiceIpcRequestOptions,
} from "@collector/service/ipc";

export type { ServiceIpcHealthResult };

/** Full API surface + transport health helpers used by smokes/harnesses. */
export interface CollectorIpcClient extends CollectorServiceApi {
  ping(options?: ServiceIpcRequestOptions): Promise<{ ok: true; pong: true }>;
  health(options?: ServiceIpcRequestOptions): Promise<ServiceIpcHealthResult>;
  close(): Promise<void>;
  /** Host watcher orchestration (#164) — not part of the in-process UI facade. */
  startVaultFilesystemWatcher(
    vaultId: string,
    vaultPath: string,
  ): Promise<void>;
  stopVaultFilesystemWatcher(): Promise<void>;
  isVaultFilesystemWatcherActive(): Promise<boolean>;
}

function unimplemented(method: string): never {
  throw serviceIpcError({
    layer: "validation",
    code: "unimplemented",
    message: `IPC method not implemented on host yet: ${method}`,
  });
}

/**
 * Wrap a low-level IPC transport as the frozen Collector API surface.
 * Domain methods fail fast; only `ping` / `health` hit the host.
 */
export function createCollectorIpcClient(
  transport: ServiceIpcClient,
): CollectorIpcClient {
  let cachedSyncStatus: VaultIndexSyncStatus = {
    vaultId: null,
    status: "idle",
    progress: null,
    metadataReady: true,
    ftsReady: true,
  };

  return {
    // Transport (host-backed)
    ping: (options) => transport.ping(options),
    health: (options) => transport.health(options),
    close: () => transport.close(),
    startVaultFilesystemWatcher: async (
      vaultId: string,
      vaultPath: string,
    ): Promise<void> => {
      await transport.request("startVaultFilesystemWatcher", {
        vaultId,
        vaultPath,
      });
    },
    stopVaultFilesystemWatcher: async (): Promise<void> => {
      await transport.request("stopVaultFilesystemWatcher");
    },
    isVaultFilesystemWatcherActive: async (): Promise<boolean> => {
      const result = (await transport.request(
        "isVaultFilesystemWatcherActive",
      )) as { active: boolean };
      return result.active;
    },

    // Boot / DB (#162)
    openCollectorDatabase: async (): Promise<void> => {
      await transport.request("openCollectorDatabase");
    },
    ensureCollectorDatabaseHealthy: async (): Promise<void> => {
      await transport.request("ensureCollectorDatabaseHealthy");
    },
    ensureActiveVault: async (): Promise<ActiveVaultResult> =>
      transport.request("ensureActiveVault") as Promise<ActiveVaultResult>,
    getDataDirectory: async (): Promise<string> =>
      transport.request("getDataDirectory") as Promise<string>,

    // Items / search / dashboard reads (#155)
    listItems: async (): Promise<ItemFile[]> =>
      transport.request("listItems") as Promise<ItemFile[]>,
    searchItems: async (
      query: string,
      filter: NavFilter,
    ): Promise<ItemFile[]> =>
      transport.request("searchItems", { query, filter }) as Promise<ItemFile[]>,
    fetchDashboardIndexPage: async (
      filter: NavFilter,
      query: string | undefined,
      page: { limit: number; offset: number },
    ): Promise<DashboardIndexPage> =>
      transport.request("fetchDashboardIndexPage", {
        filter,
        query,
        page,
      }) as Promise<DashboardIndexPage>,
    listDashboardItemIds: async (
      filter: NavFilter,
      query?: string,
    ): Promise<DashboardItemIdsResult> => {
      const result = (await transport.request("listDashboardItemIds", {
        filter,
        query,
      })) as { itemIds: string[]; totalCount: number };
      return {
        itemIds: result.itemIds,
        totalCount: result.totalCount,
        indexSync: Promise.resolve(),
      };
    },
    subscribeDashboardLoad(
      _filter: NavFilter,
      _query: string,
      _handlers: DashboardLoadHandlers,
      _signal?: AbortSignal,
    ): void {
      unimplemented("subscribeDashboardLoad");
    },
    streamDashboardItems: async (
      _itemIds: string[],
      _offset: number,
      _limit: number,
      _onItem: (item: ItemFile) => void,
      _signal?: AbortSignal,
    ): Promise<void> => unimplemented("streamDashboardItems"),
    loadDashboardItems: async (
      itemIds: string[],
      offset: number,
      limit?: number,
    ): Promise<ItemFile[]> =>
      transport.request("loadDashboardItems", {
        itemIds,
        offset,
        limit,
      }) as Promise<ItemFile[]>,
    getItemById: async (itemId: string): Promise<GetItemResult> =>
      transport.request("getItemById", { itemId }) as Promise<GetItemResult>,
    getItemSource: async (itemId: string): Promise<string> =>
      transport.request("getItemSource", { itemId }) as Promise<string>,
    updateItemSource: async (
      itemId: string,
      rawMarkdown: string,
    ): Promise<ItemFile> =>
      transport.request("updateItemSource", {
        itemId,
        rawMarkdown,
      }) as Promise<ItemFile>,
    createItem: async (input: CreateItemInput): Promise<ItemFile> =>
      transport.request("createItem", input as unknown as Record<string, unknown>) as Promise<ItemFile>,
    updateItem: async (
      itemId: string,
      input: UpdateItemInput,
    ): Promise<ItemFile> =>
      transport.request("updateItem", { itemId, input }) as Promise<ItemFile>,
    deleteItem: async (itemId: string): Promise<void> => {
      await transport.request("deleteItem", { itemId });
    },

    // Tags
    subscribeTags(
      _onUpdate: (tags: TagWithCount[]) => void,
      _handlers?: ServiceSubscribeHandlers,
      _signal?: AbortSignal,
    ): void {
      unimplemented("subscribeTags");
    },
    listTags: async (): Promise<TagWithCount[]> =>
      transport.request("listTags") as Promise<TagWithCount[]>,
    createTag: async (input: {
      name: string;
      color?: string | null;
    }): Promise<Tag> =>
      transport.request("createTag", input as unknown as Record<string, unknown>) as Promise<Tag>,
    updateTagRecord: async (
      tagId: string,
      input: { name?: string; color?: string | null },
    ): Promise<Tag> =>
      transport.request("updateTagRecord", { tagId, input }) as Promise<Tag>,
    deleteTag: async (tagId: string): Promise<void> => {
      await transport.request("deleteTag", { tagId });
    },

    // Folders
    subscribeFolderTree(
      _onUpdate: (tree: FolderTreeNode[]) => void,
      _handlers?: ServiceSubscribeHandlers,
      _signal?: AbortSignal,
    ): void {
      unimplemented("subscribeFolderTree");
    },
    listFolderTree: async (): Promise<FolderTreeNode[]> =>
      transport.request("listFolderTree") as Promise<FolderTreeNode[]>,
    loadFolderTree: async (): Promise<FolderTreeNode[]> =>
      transport.request("loadFolderTree") as Promise<FolderTreeNode[]>,
    createFolder: async (folderPath: string): Promise<string> =>
      transport.request("createFolder", { folderPath }) as Promise<string>,
    renameFolder: async (oldPath: string, newPath: string): Promise<string> =>
      transport.request("renameFolder", { oldPath, newPath }) as Promise<string>,
    deleteFolder: async (folderPath: string): Promise<void> => {
      await transport.request("deleteFolder", { folderPath });
    },
    moveItemToFolderPath: async (
      itemId: string,
      folderPath: string,
    ): Promise<ItemFile> =>
      transport.request("moveItemToFolderPath", {
        itemId,
        folderPath,
      }) as Promise<ItemFile>,

    // Media / cover
    listItemMedia: async (itemId: string): Promise<MediaWithPath[]> =>
      transport.request("listItemMedia", { itemId }) as Promise<MediaWithPath[]>,
    resolveItemThumbnailPath: async (
      item: ItemFile,
    ): Promise<string | null> =>
      transport.request("resolveItemThumbnailPath", {
        item,
      }) as Promise<string | null>,
    resolveItemThumbnailPaths: async (
      items: ItemFile[],
    ): Promise<Map<string, string | null>> => {
      const record = (await transport.request("resolveItemThumbnailPaths", {
        items,
      })) as Record<string, string | null>;
      return new Map(Object.entries(record));
    },
    setItemCoverFromMedia: async (
      itemId: string,
      mediaId: string,
    ): Promise<ItemFile> =>
      transport.request("setItemCoverFromMedia", {
        itemId,
        mediaId,
      }) as Promise<ItemFile>,
    attachMediaFiles: async (
      itemId: string,
      files: AttachMediaFileInput[],
    ): Promise<MediaFileMeta[]> =>
      transport.request("attachMediaFiles", {
        itemId,
        files: files.map((file) => ({
          filename: file.filename,
          dataBase64: Buffer.from(file.data).toString("base64"),
        })),
      }) as Promise<MediaFileMeta[]>,
    deleteItemMedia: async (itemId: string, mediaId: string): Promise<void> => {
      await transport.request("deleteItemMedia", { itemId, mediaId });
    },

    // Vaults
    listVaults: async (): Promise<VaultMeta[]> =>
      transport.request("listVaults") as Promise<VaultMeta[]>,
    getActiveVaultMeta: async (): Promise<VaultMeta> =>
      transport.request("getActiveVaultMeta") as Promise<VaultMeta>,
    switchVault: async (vaultId: string): Promise<VaultMeta> =>
      transport.request("switchVault", { vaultId }) as Promise<VaultMeta>,
    setDefaultVault: async (vaultId: string): Promise<void> => {
      await transport.request("setDefaultVault", { vaultId });
    },

    // Sync / status (#163)
    subscribeVaultIndexSyncStatus(
      onUpdate: (status: VaultIndexSyncStatus) => void,
    ): () => void {
      onUpdate(cachedSyncStatus);
      const unsubEvent = transport.onEvent(
        SERVICE_IPC_EVENTS.vaultIndexSyncStatus,
        (payload) => {
          cachedSyncStatus = payload as VaultIndexSyncStatus;
          onUpdate(cachedSyncStatus);
        },
      );
      void transport
        .request("getVaultIndexSyncStatus")
        .then((status) => {
          cachedSyncStatus = status as VaultIndexSyncStatus;
          onUpdate(cachedSyncStatus);
        })
        .catch(() => {
          // Subscribe still receives push events; seed fetch is best-effort.
        });
      return unsubEvent;
    },
    getVaultIndexSyncStatus(): VaultIndexSyncStatus {
      return cachedSyncStatus;
    },

    // Settings
    ensureAppSettings: async (): Promise<AppSettings> =>
      transport.request("ensureAppSettings") as Promise<AppSettings>,
    getAppSettingsSync(): AppSettings | null {
      unimplemented("getAppSettingsSync");
    },
    updateAppSettings: async (
      patch: Partial<AppSettings>,
    ): Promise<AppSettings> =>
      transport.request("updateAppSettings", { patch }) as Promise<AppSettings>,
    subscribeAppSettings(
      _onUpdate: (settings: AppSettings) => void,
    ): () => void {
      unimplemented("subscribeAppSettings");
    },
    getAppConfigDirectory: async (): Promise<string> =>
      transport.request("getAppConfigDirectory") as Promise<string>,

    // Dashboard snapshot
    ensureDashboardSnapshot: async (): Promise<DashboardSnapshot | null> =>
      transport.request("ensureDashboardSnapshot") as Promise<DashboardSnapshot | null>,
    peekMatchingDashboardSnapshot(_input: {
      vaultId: string;
      filter: NavFilter;
      search: string;
    }): DashboardSnapshot | null {
      unimplemented("peekMatchingDashboardSnapshot");
    },
    persistDashboardSnapshot: async (
      snapshot: DashboardSnapshot,
    ): Promise<void> => {
      await transport.request("persistDashboardSnapshot", { snapshot });
    },
    clearDashboardSnapshot: async (): Promise<void> => {
      await transport.request("clearDashboardSnapshot");
    },
    buildDashboardSnapshot(_input: {
      vaultId: string;
      filter: NavFilter;
      search: string;
      itemIds: string[];
      items: DashboardSnapshot["items"];
      totalCount: number;
      streamEndOffset: number;
    }): DashboardSnapshot {
      unimplemented("buildDashboardSnapshot");
    },
  };
}

