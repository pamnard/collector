/**
 * IPC Collector client (#154): mirrors {@link CollectorServiceApi}.
 *
 * Until host domain handlers exist, every method except transport health/ping
 * fails with validation `unimplemented` — no silent defaults / empty results.
 * Not wired into the Tauri UI (production stays in-process).
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
  connectServiceIpc,
  serviceIpcError,
  type ServiceIpcClient,
  type ServiceIpcClientOptions,
  type ServiceIpcHealthResult,
  type ServiceIpcRequestOptions,
} from "@collector/service";

export type { ServiceIpcHealthResult };

/** Full API surface + transport health helpers used by smokes/harnesses. */
export interface CollectorIpcClient extends CollectorServiceApi {
  ping(options?: ServiceIpcRequestOptions): Promise<{ ok: true; pong: true }>;
  health(options?: ServiceIpcRequestOptions): Promise<ServiceIpcHealthResult>;
  close(): Promise<void>;
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
  return {
    // Transport (host-backed)
    ping: (options) => transport.ping(options),
    health: (options) => transport.health(options),
    close: () => transport.close(),

    // Boot / DB
    openCollectorDatabase: async () => unimplemented("openCollectorDatabase"),
    ensureCollectorDatabaseHealthy: async () =>
      unimplemented("ensureCollectorDatabaseHealthy"),
    ensureActiveVault: async (): Promise<ActiveVaultResult> =>
      unimplemented("ensureActiveVault"),
    getDataDirectory: async () => unimplemented("getDataDirectory"),

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
      unimplemented("listFolderTree"),
    loadFolderTree: async (): Promise<FolderTreeNode[]> =>
      unimplemented("loadFolderTree"),
    createFolder: async (_folderPath: string): Promise<string> =>
      unimplemented("createFolder"),
    renameFolder: async (
      _oldPath: string,
      _newPath: string,
    ): Promise<string> => unimplemented("renameFolder"),
    deleteFolder: async (_folderPath: string): Promise<void> =>
      unimplemented("deleteFolder"),
    moveItemToFolderPath: async (
      _itemId: string,
      _folderPath: string,
    ): Promise<ItemFile> => unimplemented("moveItemToFolderPath"),

    // Media / cover
    listItemMedia: async (_itemId: string): Promise<MediaWithPath[]> =>
      unimplemented("listItemMedia"),
    resolveItemThumbnailPath: async (
      _item: ItemFile,
    ): Promise<string | null> => unimplemented("resolveItemThumbnailPath"),
    resolveItemThumbnailPaths: async (
      _items: ItemFile[],
    ): Promise<Map<string, string | null>> =>
      unimplemented("resolveItemThumbnailPaths"),
    setItemCoverFromMedia: async (
      _itemId: string,
      _mediaId: string,
    ): Promise<ItemFile> => unimplemented("setItemCoverFromMedia"),
    attachMediaFiles: async (
      _itemId: string,
      _files: AttachMediaFileInput[],
    ): Promise<MediaFileMeta[]> => unimplemented("attachMediaFiles"),
    deleteItemMedia: async (
      _itemId: string,
      _mediaId: string,
    ): Promise<void> => unimplemented("deleteItemMedia"),

    // Vaults
    listVaults: async (): Promise<VaultMeta[]> => unimplemented("listVaults"),
    getActiveVaultMeta: async (): Promise<VaultMeta> =>
      unimplemented("getActiveVaultMeta"),
    switchVault: async (_vaultId: string): Promise<VaultMeta> =>
      unimplemented("switchVault"),
    setDefaultVault: async (_vaultId: string): Promise<void> =>
      unimplemented("setDefaultVault"),

    // Sync / status
    subscribeVaultIndexSyncStatus(
      _onUpdate: (status: VaultIndexSyncStatus) => void,
    ): () => void {
      unimplemented("subscribeVaultIndexSyncStatus");
    },
    getVaultIndexSyncStatus(): VaultIndexSyncStatus {
      unimplemented("getVaultIndexSyncStatus");
    },

    // Settings
    ensureAppSettings: async (): Promise<AppSettings> =>
      unimplemented("ensureAppSettings"),
    getAppSettingsSync(): AppSettings | null {
      unimplemented("getAppSettingsSync");
    },
    updateAppSettings: async (
      _patch: Partial<AppSettings>,
    ): Promise<AppSettings> => unimplemented("updateAppSettings"),
    subscribeAppSettings(
      _onUpdate: (settings: AppSettings) => void,
    ): () => void {
      unimplemented("subscribeAppSettings");
    },
    getAppConfigDirectory: async (): Promise<string> =>
      unimplemented("getAppConfigDirectory"),

    // Dashboard snapshot
    ensureDashboardSnapshot: async (): Promise<DashboardSnapshot | null> =>
      unimplemented("ensureDashboardSnapshot"),
    peekMatchingDashboardSnapshot(_input: {
      vaultId: string;
      filter: NavFilter;
      search: string;
    }): DashboardSnapshot | null {
      unimplemented("peekMatchingDashboardSnapshot");
    },
    persistDashboardSnapshot: async (
      _snapshot: DashboardSnapshot,
    ): Promise<void> => unimplemented("persistDashboardSnapshot"),
    clearDashboardSnapshot: async (): Promise<void> =>
      unimplemented("clearDashboardSnapshot"),
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

/** Dial the out-of-band service host and return the API-shaped IPC client. */
export async function connectCollectorIpcClient(
  path: string,
  options?: ServiceIpcClientOptions,
): Promise<CollectorIpcClient> {
  const transport = await connectServiceIpc(path, options);
  return createCollectorIpcClient(transport);
}
