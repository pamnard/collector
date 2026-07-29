/**
 * IPC Collector client (#154 / #366): domain ports primary; flat API transitional.
 *
 * Browser-safe with injectable transport (#240/#241). Node dialer: `./node`.
 * UI subscribe/stream/settings helpers orchestrate host RPCs.
 * Flat wire method names remain transitional aliases for port methods.
 */

import type {
  ActiveVaultResult,
  AttachMediaFileInput,
  CollectorService,
  CollectorServiceApi,
  CreateItemInput,
  DashboardIndexPage,
  DashboardItemIdsResult,
  DashboardItemSort,
  DashboardLoadHandlers,
  DashboardSnapshotPort,
  FolderTreeNode,
  GetItemResult,
  AdjacentItemsResult,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
  IndexQueryResult,
  MediaWithPath,
  NavFilter,
  ServiceSubscribeHandlers,
  Subscription,
  TagWithCount,
  UiSessionThumbnailPaths,
  UpdateItemInput,
  VaultIndexSyncStatus,
} from "@collector/api";
import {
  asCollectorApiError,
  DASHBOARD_PREFETCH_SIZE,
  subscriptionFromTeardown,
  toCollectorServiceApi,
} from "@collector/api";
import type {
  AppSettings,
  DashboardSnapshot,
  ItemFile,
  MediaFileMeta,
  Tag,
  VaultMeta,
} from "@collector/shared";
import { dashboardSnapshotMatchesQuery } from "@collector/shared";
import {
  SERVICE_IPC_EVENTS,
  type ServiceIpcClient,
  type ServiceIpcHealthResult,
  type ServiceIpcRequestOptions,
} from "@collector/service/ipc";

export type { ServiceIpcHealthResult };

/**
 * UI-only slices injected by the app / Node dialer (#368).
 * Not host IPC — snapshot I/O and abs thumbnail paths stay client-side.
 */
export interface CollectorIpcClientOptions {
  snapshot?: DashboardSnapshotPort;
  thumbnails?: UiSessionThumbnailPaths;
}

/** Transport extras used by smokes/harnesses — not part of CollectorService. */
export interface CollectorIpcTransportExtras {
  ping(options?: ServiceIpcRequestOptions): Promise<{ ok: true; pong: true }>;
  health(options?: ServiceIpcRequestOptions): Promise<ServiceIpcHealthResult>;
  close(): Promise<void>;
  /** Host watcher orchestration (#164) — not part of the domain ports. */
  startVaultFilesystemWatcher(
    vaultId: string,
    vaultPath: string,
  ): Promise<void>;
  stopVaultFilesystemWatcher(): Promise<void>;
  isVaultFilesystemWatcherActive(): Promise<boolean>;
}

/** Full flat API surface + transport health helpers. */
export interface CollectorIpcClient
  extends CollectorServiceApi, CollectorIpcTransportExtras {}

/** Domain ports + transport health helpers (#369). Primary for CLI/MCP. */
export type CollectorIpcServiceClient = CollectorService &
  CollectorIpcTransportExtras;

function navFilterToSetting(
  filter: NavFilter,
):
  | "all"
  | { type: "tag"; tag_id: string }
  | { type: "folder"; folder_path: string } {
  if (typeof filter === "object" && filter !== null && "type" in filter) {
    if (filter.type === "tag" && "tagId" in filter) {
      return { type: "tag", tag_id: String(filter.tagId) };
    }
    if (filter.type === "folder" && "folderPath" in filter) {
      return { type: "folder", folder_path: String(filter.folderPath) };
    }
  }
  return "all";
}

type IpcBacking = {
  service: CollectorService;
  snapshot: DashboardSnapshotPort;
  extras: CollectorIpcTransportExtras;
};

function createMemoryDashboardSnapshotPort(): DashboardSnapshotPort {
  let snapshotCache: DashboardSnapshot | null = null;
  let snapshotCacheLoaded = false;

  return {
    ensureDashboardSnapshot: async (): Promise<DashboardSnapshot | null> => {
      snapshotCacheLoaded = true;
      return snapshotCache;
    },
    peekMatchingDashboardSnapshot(input: {
      vaultId: string;
      filter: NavFilter;
      search: string;
      sort?: DashboardItemSort;
    }): DashboardSnapshot | null {
      if (!snapshotCacheLoaded || !snapshotCache) {
        return null;
      }
      if (
        !dashboardSnapshotMatchesQuery(snapshotCache, {
          vaultId: input.vaultId,
          navFilter: navFilterToSetting(input.filter),
          search: input.search,
          sortKey: input.sort?.key,
          sortDir: input.sort?.dir,
        })
      ) {
        return null;
      }
      return snapshotCache;
    },
    persistDashboardSnapshot: async (
      next: DashboardSnapshot,
    ): Promise<void> => {
      snapshotCache = next;
      snapshotCacheLoaded = true;
    },
    clearDashboardSnapshot: async (): Promise<void> => {
      snapshotCache = null;
      snapshotCacheLoaded = true;
    },
    buildDashboardSnapshot(input: {
      vaultId: string;
      filter: NavFilter;
      search: string;
      sort?: DashboardItemSort;
      itemIds: string[];
      items: DashboardSnapshot["items"];
      totalCount: number;
      streamEndOffset: number;
    }): DashboardSnapshot {
      return {
        schema_version: 1,
        vault_id: input.vaultId,
        nav_filter: navFilterToSetting(input.filter),
        search: input.search,
        sort_key: input.sort?.key ?? "created_at",
        sort_dir: input.sort?.dir ?? "desc",
        item_ids: input.itemIds,
        items: input.items,
        total_count: input.totalCount,
        stream_end_offset: input.streamEndOffset,
        saved_at: new Date().toISOString(),
      };
    },
  };
}

function createNullThumbnailPaths(): UiSessionThumbnailPaths {
  return {
    resolveItemThumbnailPath: async (): Promise<string | null> => null,
    resolveItemThumbnailPaths: async (
      items: ItemFile[],
    ): Promise<Map<string, string | null>> =>
      new Map(items.map((item) => [item.id, null])),
  };
}

/**
 * Shared transport session: one cache set for ports + snapshot + extras (#366 / #368).
 */
function createIpcBacking(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): IpcBacking {
  let cachedSyncStatus: VaultIndexSyncStatus = {
    vaultId: null,
    status: "idle",
    progress: null,
    metadataReady: true,
    ftsReady: true,
  };
  let settingsCache: AppSettings | null = null;
  const thumbnails = options.thumbnails ?? createNullThumbnailPaths();

  const extras: CollectorIpcTransportExtras = {
    ping: (options) => transport.ping(options),
    health: (options) => transport.health(options),
    close: () => transport.close(),
    startVaultFilesystemWatcher: async (vaultId, vaultPath) => {
      await transport.request("startVaultFilesystemWatcher", {
        vaultId,
        vaultPath,
      });
    },
    stopVaultFilesystemWatcher: async () => {
      await transport.request("stopVaultFilesystemWatcher");
    },
    isVaultFilesystemWatcherActive: async () => {
      const result = (await transport.request(
        "isVaultFilesystemWatcherActive",
      )) as { active: boolean };
      return result.active;
    },
  };

  const service: CollectorService = {
    boot: {
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
    },
    items: {
      searchItems: async (
        query: string,
        filter: NavFilter,
      ): Promise<ItemFile[]> =>
        transport.request("searchItems", {
          query,
          filter,
        }) as Promise<ItemFile[]>,
      queryIndex: async (
        filter: NavFilter,
        query: string | undefined,
        page: { limit: number; offset: number },
        sort?: DashboardItemSort,
      ): Promise<IndexQueryResult> =>
        transport.request("queryIndex", {
          filter,
          query,
          page,
          sort,
        }) as Promise<IndexQueryResult>,
      async *hydrate(
        ids: string[],
        options?: { signal?: AbortSignal },
      ): AsyncIterable<ItemFile> {
        if (!ids.length || options?.signal?.aborted) {
          return;
        }
        const items = (await transport.request("loadDashboardItems", {
          itemIds: ids,
          offset: 0,
          limit: ids.length,
        })) as ItemFile[];
        for (const item of items) {
          if (options?.signal?.aborted) {
            return;
          }
          yield item;
        }
      },
      fetchDashboardIndexPage: async (
        filter: NavFilter,
        query: string | undefined,
        page: { limit: number; offset: number },
        sort?: DashboardItemSort,
      ): Promise<DashboardIndexPage> =>
        transport.request("fetchDashboardIndexPage", {
          filter,
          query,
          page,
          sort,
        }) as Promise<DashboardIndexPage>,
      listDashboardItemIds: async (
        filter: NavFilter,
        query?: string,
        sort?: DashboardItemSort,
      ): Promise<DashboardItemIdsResult> => {
        const result = (await transport.request("listDashboardItemIds", {
          filter,
          query,
          sort,
        })) as { itemIds: string[]; totalCount: number };
        // Over IPC `indexSync` is not a real wait — use vault index sync status (#163).
        return {
          itemIds: result.itemIds,
          totalCount: result.totalCount,
          indexSync: Promise.resolve(),
        };
      },
      subscribeDashboardLoad(
        filter: NavFilter,
        query: string,
        handlers: DashboardLoadHandlers,
        signal?: AbortSignal,
        sort?: DashboardItemSort,
      ): Subscription {
        const controller = new AbortController();
        if (signal) {
          if (signal.aborted) {
            controller.abort();
          } else {
            signal.addEventListener("abort", () => controller.abort(), {
              once: true,
            });
          }
        }
        const active = controller.signal;
        void (async () => {
          try {
            if (active.aborted) {
              return;
            }
            const page = (await transport.request("fetchDashboardIndexPage", {
              filter,
              query,
              page: { limit: DASHBOARD_PREFETCH_SIZE, offset: 0 },
              sort,
            })) as DashboardIndexPage;
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
      },
      streamDashboardItems: async (
        itemIds: string[],
        offset: number,
        limit: number,
        onItem: (item: ItemFile) => void,
        signal?: AbortSignal,
      ): Promise<void> => {
        const items = (await transport.request("loadDashboardItems", {
          itemIds,
          offset,
          limit,
        })) as ItemFile[];
        for (const item of items) {
          if (signal?.aborted) {
            return;
          }
          onItem(item);
        }
      },
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
      getAdjacentItems: async (itemId: string): Promise<AdjacentItemsResult> =>
        transport.request("getAdjacentItems", {
          itemId,
        }) as Promise<AdjacentItemsResult>,
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
        transport.request(
          "createItem",
          input as unknown as Record<string, unknown>,
        ) as Promise<ItemFile>,
      updateItem: async (
        itemId: string,
        input: UpdateItemInput,
      ): Promise<ItemFile> =>
        transport.request("updateItem", {
          itemId,
          input,
        }) as Promise<ItemFile>,
      deleteItem: async (itemId: string): Promise<void> => {
        await transport.request("deleteItem", { itemId });
      },
      importDroppedFiles: async (
        input: ImportDroppedFilesInput,
      ): Promise<ImportDroppedFilesResult> =>
        transport.request("importDroppedFiles", {
          folder_path: input.folder_path,
          files: input.files.map((file) => ({
            relativePath: file.relativePath,
            filename: file.name,
            dataBase64: Buffer.from(file.bytes).toString("base64"),
          })),
        }) as Promise<ImportDroppedFilesResult>,
    },
    tags: {
      subscribeTags(
        onUpdate: (tags: TagWithCount[]) => void,
        handlers?: ServiceSubscribeHandlers,
        signal?: AbortSignal,
      ): Subscription {
        const controller = new AbortController();
        if (signal) {
          if (signal.aborted) {
            controller.abort();
          } else {
            signal.addEventListener("abort", () => controller.abort(), {
              once: true,
            });
          }
        }
        const active = controller.signal;
        void (async () => {
          try {
            if (active.aborted) {
              return;
            }
            onUpdate((await transport.request("listTags")) as TagWithCount[]);
          } catch (error: unknown) {
            if (!active.aborted) {
              handlers?.onError?.("tags", asCollectorApiError(error));
            }
          }
        })();
        return subscriptionFromTeardown(() => controller.abort());
      },
      listTags: async (): Promise<TagWithCount[]> =>
        transport.request("listTags") as Promise<TagWithCount[]>,
      createTag: async (input: {
        name: string;
        color?: string | null;
      }): Promise<Tag> =>
        transport.request(
          "createTag",
          input as unknown as Record<string, unknown>,
        ) as Promise<Tag>,
      updateTagRecord: async (
        tagId: string,
        input: { name?: string; color?: string | null },
      ): Promise<Tag> =>
        transport.request("updateTagRecord", {
          tagId,
          input,
        }) as Promise<Tag>,
      deleteTag: async (tagId: string): Promise<void> => {
        await transport.request("deleteTag", { tagId });
      },
    },
    folders: {
      subscribeFolderTree(
        onUpdate: (tree: FolderTreeNode[]) => void,
        handlers?: ServiceSubscribeHandlers,
        signal?: AbortSignal,
      ): Subscription {
        const controller = new AbortController();
        if (signal) {
          if (signal.aborted) {
            controller.abort();
          } else {
            signal.addEventListener("abort", () => controller.abort(), {
              once: true,
            });
          }
        }
        const active = controller.signal;
        void (async () => {
          try {
            if (active.aborted) {
              return;
            }
            onUpdate(
              (await transport.request("listFolderTree")) as FolderTreeNode[],
            );
          } catch (error: unknown) {
            if (!active.aborted) {
              handlers?.onError?.("folder tree", asCollectorApiError(error));
            }
          }
        })();
        return subscriptionFromTeardown(() => controller.abort());
      },
      listFolderTree: async (): Promise<FolderTreeNode[]> =>
        transport.request("listFolderTree") as Promise<FolderTreeNode[]>,
      createFolder: async (folderPath: string): Promise<string> =>
        transport.request("createFolder", { folderPath }) as Promise<string>,
      renameFolder: async (oldPath: string, newPath: string): Promise<string> =>
        transport.request("renameFolder", {
          oldPath,
          newPath,
        }) as Promise<string>,
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
    },
    media: {
      listItemMedia: async (itemId: string): Promise<MediaWithPath[]> =>
        transport.request("listItemMedia", {
          itemId,
        }) as Promise<MediaWithPath[]>,
      resolveItemThumbnailPath: (item: ItemFile): Promise<string | null> =>
        thumbnails.resolveItemThumbnailPath(item),
      resolveItemThumbnailPaths: (
        items: ItemFile[],
      ): Promise<Map<string, string | null>> =>
        thumbnails.resolveItemThumbnailPaths(items),
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
            filename: file.name,
            dataBase64: Buffer.from(file.bytes).toString("base64"),
          })),
        }) as Promise<MediaFileMeta[]>,
      replaceItemMedia: async (
        itemId: string,
        mediaId: string,
        file: AttachMediaFileInput,
      ): Promise<MediaFileMeta> =>
        transport.request("replaceItemMedia", {
          itemId,
          mediaId,
          file: {
            filename: file.name,
            dataBase64: Buffer.from(file.bytes).toString("base64"),
          },
        }) as Promise<MediaFileMeta>,
      deleteItemMedia: async (
        itemId: string,
        mediaId: string,
      ): Promise<void> => {
        await transport.request("deleteItemMedia", { itemId, mediaId });
      },
    },
    vaults: {
      listVaults: async (): Promise<VaultMeta[]> =>
        transport.request("listVaults") as Promise<VaultMeta[]>,
      getActiveVaultMeta: async (): Promise<VaultMeta> =>
        transport.request("getActiveVaultMeta") as Promise<VaultMeta>,
      switchVault: async (vaultId: string): Promise<VaultMeta> =>
        transport.request("switchVault", { vaultId }) as Promise<VaultMeta>,
      setDefaultVault: async (vaultId: string): Promise<void> => {
        await transport.request("setDefaultVault", { vaultId });
      },
    },
    index: {
      subscribeVaultIndexSyncStatus(
        onUpdate: (status: VaultIndexSyncStatus) => void,
      ): Subscription {
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
        return subscriptionFromTeardown(unsubEvent);
      },
      getVaultIndexSyncStatus(): VaultIndexSyncStatus {
        return cachedSyncStatus;
      },
    },
    settings: {
      ensureAppSettings: async (): Promise<AppSettings> => {
        settingsCache = (await transport.request(
          "ensureAppSettings",
        )) as AppSettings;
        return settingsCache;
      },
      getAppSettingsSync(): AppSettings | null {
        return settingsCache;
      },
      updateAppSettings: async (
        patch: Partial<AppSettings>,
      ): Promise<AppSettings> => {
        settingsCache = (await transport.request("updateAppSettings", {
          patch,
        })) as AppSettings;
        return settingsCache;
      },
      subscribeAppSettings(
        onUpdate: (settings: AppSettings) => void,
      ): Subscription {
        if (settingsCache) {
          onUpdate(settingsCache);
        }
        let sawPush = false;
        const unsubEvent = transport.onEvent(
          SERVICE_IPC_EVENTS.appSettings,
          (payload) => {
            sawPush = true;
            settingsCache = payload as AppSettings;
            onUpdate(settingsCache);
          },
        );
        void transport
          .request("ensureAppSettings")
          .then((settings) => {
            // Do not clobber a newer host push that arrived during seed (#329).
            if (sawPush) {
              return;
            }
            settingsCache = settings as AppSettings;
            onUpdate(settingsCache);
          })
          .catch(() => {
            // Subscribe still receives push events; seed fetch is best-effort.
          });
        return subscriptionFromTeardown(unsubEvent);
      },
      getAppConfigDirectory: async (): Promise<string> =>
        transport.request("getAppConfigDirectory") as Promise<string>,
    },
  };

  const snapshot =
    options.snapshot ?? createMemoryDashboardSnapshotPort();

  return { service, snapshot, extras };
}

/** Domain ports over IPC transport (#366 / #368). */
export function createCollectorIpcService(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): CollectorService {
  return createIpcBacking(transport, options).service;
}

/** Domain ports + transport extras for CLI/MCP (#369). */
export function createCollectorIpcServiceClient(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): CollectorIpcServiceClient {
  const { service, extras } = createIpcBacking(transport, options);
  return { ...service, ...extras };
}

/**
 * Dashboard snapshot slice for flat shim / UiSession (#363 / #368).
 * Default is in-memory; app/Node inject disk-backed ports.
 */
export function createCollectorIpcDashboardSnapshotPort(
  _transport?: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): DashboardSnapshotPort {
  return options.snapshot ?? createMemoryDashboardSnapshotPort();
}

/**
 * Transitional flat facade (#145 → #360). Prefer
 * {@link createCollectorIpcService} + {@link createCollectorIpcDashboardSnapshotPort}.
 * Pass {@link CollectorIpcClientOptions} for snapshot/thumbnails (#368).
 */
export function createCollectorIpcClient(
  transport: ServiceIpcClient,
  options: CollectorIpcClientOptions = {},
): CollectorIpcClient {
  const { service, snapshot, extras } = createIpcBacking(transport, options);
  return {
    ...toCollectorServiceApi(service, snapshot),
    ...extras,
  };
}
