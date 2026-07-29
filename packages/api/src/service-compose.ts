import type {
  BootPort,
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
