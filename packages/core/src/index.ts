export type {
  CreateVaultInput,
  FileSystemAdapter,
  IndexedItem,
  IndexedItemMetadata,
  IndexSyncOptions,
  IndexSyncPhase,
  IndexSyncProgress,
  ItemContentUpsert,
  SyncReport,
  UpsertItemInput,
  VaultContext,
  VaultIndexAdapter,
} from "./adapters/types.js";

export {
  itemContentPath,
  itemCoverPath,
  itemCoverRelativePath,
  itemMediaRoot,
  itemMetaPath,
  itemRoot,
  itemSourcePath,
  itemsRoot,
  joinSegments,
  vaultMetaPath,
  vaultsRoot,
  vaultRoot,
} from "./vault/paths.js";

export {
  readItemContent,
  readItemFile,
  readItemSourceRef,
  readVaultMeta,
  writeItemContent,
  writeItemFile,
  writeItemSourceRef,
  writeVaultMeta,
} from "./vault/item-io.js";

export {
  createVault,
  deleteItem,
  listItemsByIds,
  listItemsOnDisk,
  streamItemsByIds,
  syncIndexFromFilesystem,
  upsertItem,
} from "./vault/operations.js";
export type { StreamedItemRead, StreamItemsByIdsOptions } from "./vault/operations.js";

export {
  createSingleFlight,
  DISK_ITEM_READ_CONCURRENCY,
} from "./util/concurrency.js";

export { syncVaultIndexFromFilesystem } from "./vault/index-sync.js";
export type { VaultIndexSyncReport } from "./vault/index-sync.js";

export { buildFtsMatchQuery } from "./search/fts-query.js";
export type { NavSearchFilter } from "./search/nav-filter.js";
export { navFilterFromSetting, navFilterToSetting, isFolderFilter, isTagFilter } from "./search/nav-filter.js";

export {
  createFolder,
  deleteFolder,
  listFolderTree,
  listFolderTreeFromIndex,
  reconcileFolderTreeFromDisk,
  buildFolderTreeFromSources,
  collectItemFolderPaths,
  mergeFolderCountRows,
  publishFolderTreeFromLayers,
  readVaultFolderPaths,
  moveItemToFolder,
  renameFolder,
} from "./vault/folder-operations.js";
export type { FolderTreeNode } from "./vault/folder-tree.js";

export {
  createTag,
  deleteTag,
  listTagsWithCounts,
  syncTagsToIndex,
  updateTag,
} from "./vault/tag-operations.js";
export type { TagWithCount } from "./vault/tag-operations.js";
export {
  attachMediaFile,
  deleteMediaFile,
  listItemMediaWithPaths,
  syncItemMediaToIndex,
} from "./vault/media-operations.js";
export type { MediaWithPath } from "./vault/media-operations.js";
export { listMediaFiles, mediaFilePath } from "./vault/media-io.js";
export {
  applyItemCover,
  clearItemCover,
  resolveItemThumbnailAbsolutePath,
} from "./vault/cover-operations.js";

export { SqlVaultIndexAdapter, SqlVaultIndexStore } from "./index/sql-index.js";
export type { SqlSelector } from "./index/sql-index.js";

export {
  createDefaultAppSettings,
  mergeAppSettings,
  readAppSettings,
  writeAppSettings,
  appSettingsPath,
} from "./settings/app-settings-io.js";

export {
  migrateItemSchema,
  migrateVaultSchema,
} from "./vault/schema-migrate.js";
