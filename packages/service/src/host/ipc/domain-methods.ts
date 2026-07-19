/**
 * Domain IPC method names (#155+). Transport ping/health stay separate.
 */

export const DOMAIN_IPC_METHODS = {
  // #155 reads
  listItems: "listItems",
  searchItems: "searchItems",
  fetchDashboardIndexPage: "fetchDashboardIndexPage",
  listDashboardItemIds: "listDashboardItemIds",
  loadDashboardItems: "loadDashboardItems",
  getItemById: "getItemById",
  getItemSource: "getItemSource",
  // #156 writes
  createItem: "createItem",
  updateItem: "updateItem",
  deleteItem: "deleteItem",
  updateItemSource: "updateItemSource",
  // #157 tags
  listTags: "listTags",
  createTag: "createTag",
  updateTagRecord: "updateTagRecord",
  deleteTag: "deleteTag",
  // #158 folders
  listFolderTree: "listFolderTree",
  loadFolderTree: "loadFolderTree",
  createFolder: "createFolder",
  renameFolder: "renameFolder",
  deleteFolder: "deleteFolder",
  moveItemToFolderPath: "moveItemToFolderPath",
  // #159 media
  listItemMedia: "listItemMedia",
  setItemCoverFromMedia: "setItemCoverFromMedia",
  attachMediaFiles: "attachMediaFiles",
  deleteItemMedia: "deleteItemMedia",
  resolveItemThumbnailPath: "resolveItemThumbnailPath",
  resolveItemThumbnailPaths: "resolveItemThumbnailPaths",
  // #160 vaults
  listVaults: "listVaults",
  getActiveVaultMeta: "getActiveVaultMeta",
  switchVault: "switchVault",
  setDefaultVault: "setDefaultVault",
  ensureActiveVault: "ensureActiveVault",
  getDataDirectory: "getDataDirectory",
  // #161 settings + snapshot
  ensureAppSettings: "ensureAppSettings",
  updateAppSettings: "updateAppSettings",
  getAppConfigDirectory: "getAppConfigDirectory",
  ensureDashboardSnapshot: "ensureDashboardSnapshot",
  persistDashboardSnapshot: "persistDashboardSnapshot",
  clearDashboardSnapshot: "clearDashboardSnapshot",
  peekMatchingDashboardSnapshot: "peekMatchingDashboardSnapshot",
  buildDashboardSnapshot: "buildDashboardSnapshot",
} as const;

export type DomainIpcMethod =
  (typeof DOMAIN_IPC_METHODS)[keyof typeof DOMAIN_IPC_METHODS];

export type ServiceIpcCoreMethod = "ping" | "health";
export type ServiceIpcMethod = ServiceIpcCoreMethod | DomainIpcMethod | string;

export type DomainIpcHandler = (params?: unknown) => Promise<unknown>;
export type DomainIpcHandlerMap = Record<string, DomainIpcHandler>;
