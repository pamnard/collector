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
  VaultItemMetaRead,
  VaultItemStatMeta,
} from "./adapters/types.js";

export {
  basename,
  dirname,
  isMarkdownItemFile,
  isReservedVaultEntry,
  itemCoverPath,
  itemCoverRelativePath,
  itemMarkdownPath,
  itemMediaDirName,
  itemMediaManifestPath,
  itemMediaRoot,
  itemSourcePath,
  joinSegments,
  legacyFoldersPath,
  legacyItemContentPath,
  legacyItemMediaRoot,
  legacyItemMetaPath,
  legacyItemRoot,
  legacyItemsRoot,
  normalizeRelativePath,
  RECONCILE_TOUCH_FILE,
  vaultMetaPath,
  vaultsRoot,
  vaultRoot,
} from "./vault/paths.js";

export { listFolderRelativePaths, listItemRelativePaths } from "./vault/scan.js";

export {
  ensureTagsByName,
  itemFileFromDocumentMarkdown,
  readItemContent,
  readItemDocument,
  readItemFile,
  readItemSourceRef,
  readVaultMeta,
  writeItemContent,
  writeItemDocument,
  writeItemFile,
  writeItemSourceRef,
  writeVaultMeta,
} from "./vault/item-io.js";

export {
  buildTagMaps,
  parseItemDocument,
  parseItemDocumentResolved,
  serializeItemDocument,
} from "./vault/item-document.js";

export {
  buildCanonicalFrontmatter,
  contentTypeFromFrontmatter,
  extractUnknownFrontmatterKeys,
  parseDocumentMarkdown,
  parseKnownFrontmatter,
  resolveFrontmatterDates,
  serializeDocumentMarkdown,
} from "./vault/frontmatter.js";

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

export { syncIndexItemsFromFilesystem } from "./vault/item-index-sync.js";

export {
  createVaultWatchBatcher,
  dedupeVaultWatchItemIds,
} from "./vault/vault-watch-batch.js";
export type { VaultWatchBatcher } from "./vault/vault-watch-batch.js";

export { parseVaultItemWatchPath } from "./vault/vault-watch-path.js";

export {
  createSingleFlight,
  DISK_ITEM_READ_CONCURRENCY,
} from "./util/concurrency.js";

export { createTwoPhaseBootGate } from "./util/boot-gate.js";
export type { TwoPhaseBootGate } from "./util/boot-gate.js";

export { formatIndexingBannerLabel } from "./util/indexing-banner.js";
export type {
  IndexBannerInput,
  IndexBannerStatus,
} from "./util/indexing-banner.js";

export { syncVaultIndexFromFilesystem } from "./vault/index-sync.js";
export type { VaultIndexSyncReport } from "./vault/index-sync.js";

export {
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
} from "./search/fts-query.js";
export type { NavSearchFilter } from "./search/nav-filter.js";
export { navFilterFromSetting, navFilterToSetting, isFolderFilter, isTagFilter } from "./search/nav-filter.js";

export {
  createFolder,
  deleteFolder,
  listFolderTree,
  listFolderTreeFromIndex,
  reconcileFolderTreeFromDisk,
  buildFolderTreeFromSources,
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
  clearDashboardSnapshot,
  dashboardSnapshotPath,
  readDashboardSnapshot,
  writeDashboardSnapshot,
} from "./settings/dashboard-snapshot-io.js";

export { migrateVaultSchema } from "./vault/schema-migrate.js";
