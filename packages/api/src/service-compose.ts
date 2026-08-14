import type {
  BootPort,
  CredentialsPort,
  DashboardSnapshotPort,
  FoldersPort,
  IndexPort,
  ItemsPort,
  JobsPort,
  MediaPort,
  SettingsPort,
  SyncPluginsPort,
  TagsPort,
  TelegramSyncPort,
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
  "findSimilarItems",
  "resolveContentTextLinks",
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
  "subscribeVaultPresentationChanged",
] as const satisfies readonly (keyof IndexPort)[];

export const JOBS_PORT_KEYS = [
  "getJobStats",
  "subscribeJobPermanentFailure",
] as const satisfies readonly (keyof JobsPort)[];

export const SETTINGS_PORT_KEYS = [
  "ensureAppSettings",
  "getAppSettingsSync",
  "updateAppSettings",
  "subscribeAppSettings",
  "getAppConfigDirectory",
] as const satisfies readonly (keyof SettingsPort)[];

export const CREDENTIALS_PORT_KEYS = [
  "setCredential",
  "getCredential",
  "hasCredential",
  "deleteCredential",
  "getCredentialsAvailability",
] as const satisfies readonly (keyof CredentialsPort)[];

export const SYNC_PLUGINS_PORT_KEYS = [
  "syncNow",
] as const satisfies readonly (keyof SyncPluginsPort)[];

export const TELEGRAM_SYNC_PORT_KEYS = [
  "getTelegramSyncSettings",
  "updateTelegramSyncSettings",
  "validateTelegramBotToken",
] as const satisfies readonly (keyof TelegramSyncPort)[];

export const DASHBOARD_SNAPSHOT_PORT_KEYS = [
  "ensureDashboardSnapshot",
  "peekMatchingDashboardSnapshot",
  "persistDashboardSnapshot",
  "clearDashboardSnapshot",
  "buildDashboardSnapshot",
] as const satisfies readonly (keyof DashboardSnapshotPort)[];
