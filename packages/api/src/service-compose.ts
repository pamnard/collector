import type {
  BootPort,
  CollectorService,
  CollectorServiceApi,
  DashboardSnapshotPort,
  FoldersPort,
  IndexPort,
  ItemsPort,
  MediaPort,
  SettingsPort,
  TagsPort,
  VaultsPort,
} from "./service-api.js";

export const BOOT_PORT_KEYS = [
  "openCollectorDatabase",
  "ensureCollectorDatabaseHealthy",
  "ensureActiveVault",
  "getDataDirectory",
] as const satisfies readonly (keyof BootPort)[];

export const ITEMS_PORT_KEYS = [
  "listItems",
  "searchItems",
  "queryIndex",
  "hydrate",
  "fetchDashboardIndexPage",
  "listDashboardItemIds",
  "subscribeDashboardLoad",
  "streamDashboardItems",
  "loadDashboardItems",
  "getItemById",
  "getAdjacentItems",
  "getItemSource",
  "updateItemSource",
  "createItem",
  "updateItem",
  "deleteItem",
  "importDroppedFiles",
] as const satisfies readonly (keyof ItemsPort)[];

export const TAGS_PORT_KEYS = [
  "subscribeTags",
  "listTags",
  "createTag",
  "updateTagRecord",
  "deleteTag",
] as const satisfies readonly (keyof TagsPort)[];

export const FOLDERS_PORT_KEYS = [
  "subscribeFolderTree",
  "listFolderTree",
  "loadFolderTree",
  "createFolder",
  "renameFolder",
  "deleteFolder",
  "moveItemToFolderPath",
] as const satisfies readonly (keyof FoldersPort)[];

export const MEDIA_PORT_KEYS = [
  "listItemMedia",
  "resolveItemThumbnailPath",
  "resolveItemThumbnailPaths",
  "setItemCoverFromMedia",
  "attachMediaFiles",
  "replaceItemMedia",
  "deleteItemMedia",
] as const satisfies readonly (keyof MediaPort)[];

export const VAULTS_PORT_KEYS = [
  "listVaults",
  "getActiveVaultMeta",
  "switchVault",
  "setDefaultVault",
] as const satisfies readonly (keyof VaultsPort)[];

export const INDEX_PORT_KEYS = [
  "subscribeVaultIndexSyncStatus",
  "getVaultIndexSyncStatus",
] as const satisfies readonly (keyof IndexPort)[];

export const SETTINGS_PORT_KEYS = [
  "ensureAppSettings",
  "getAppSettingsSync",
  "updateAppSettings",
  "subscribeAppSettings",
  "getAppConfigDirectory",
] as const satisfies readonly (keyof SettingsPort)[];

export const DASHBOARD_SNAPSHOT_PORT_KEYS = [
  "ensureDashboardSnapshot",
  "peekMatchingDashboardSnapshot",
  "persistDashboardSnapshot",
  "clearDashboardSnapshot",
  "buildDashboardSnapshot",
] as const satisfies readonly (keyof DashboardSnapshotPort)[];

function pickPort<T extends object, const K extends readonly (keyof T)[]>(
  source: T,
  keys: K,
): Pick<T, K[number]> {
  const out = {} as Pick<T, K[number]>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "function") {
      // Bind methods to the flat facade so `this` stays stable if an impl uses it.
      (out as Record<string, unknown>)[key as string] = (
        value as (...args: unknown[]) => unknown
      ).bind(source);
    } else {
      (out as Record<string, unknown>)[key as string] = value;
    }
  }
  return out;
}

/** Lift a flat {@link CollectorServiceApi} into port-segmented {@link CollectorService}. */
export function toCollectorService(flat: CollectorServiceApi): CollectorService {
  return {
    boot: pickPort(flat, BOOT_PORT_KEYS),
    items: pickPort(flat, ITEMS_PORT_KEYS),
    tags: pickPort(flat, TAGS_PORT_KEYS),
    folders: pickPort(flat, FOLDERS_PORT_KEYS),
    media: pickPort(flat, MEDIA_PORT_KEYS),
    vaults: pickPort(flat, VAULTS_PORT_KEYS),
    index: pickPort(flat, INDEX_PORT_KEYS),
    settings: pickPort(flat, SETTINGS_PORT_KEYS),
  };
}

function assignPort<T extends object, const K extends readonly (keyof T)[]>(
  target: Record<string, unknown>,
  port: T,
  keys: K,
): void {
  for (const key of keys) {
    const value = port[key];
    if (typeof value === "function") {
      target[key as string] = (value as (...args: unknown[]) => unknown).bind(
        port,
      );
    } else {
      target[key as string] = value;
    }
  }
}

/**
 * Flatten ports (+ required snapshot slice) back to the transitional flat API.
 * Snapshot is separate because it is not a {@link CollectorService} key (#363).
 */
export function toCollectorServiceApi(
  service: CollectorService,
  snapshot: DashboardSnapshotPort,
): CollectorServiceApi {
  const flat: Record<string, unknown> = {};
  assignPort(flat, service.boot, BOOT_PORT_KEYS);
  assignPort(flat, service.items, ITEMS_PORT_KEYS);
  assignPort(flat, service.tags, TAGS_PORT_KEYS);
  assignPort(flat, service.folders, FOLDERS_PORT_KEYS);
  assignPort(flat, service.media, MEDIA_PORT_KEYS);
  assignPort(flat, service.vaults, VAULTS_PORT_KEYS);
  assignPort(flat, service.index, INDEX_PORT_KEYS);
  assignPort(flat, service.settings, SETTINGS_PORT_KEYS);
  assignPort(flat, snapshot, DASHBOARD_SNAPSHOT_PORT_KEYS);
  return flat as unknown as CollectorServiceApi;
}
