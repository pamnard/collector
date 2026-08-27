export type {
  CreateVaultInput,
  FileSystemAdapter,
  IndexedItem,
  IndexedItemMetadata,
  IndexSyncOptions,
  IndexSyncPhase,
  IndexSyncProgress,
  ItemContentUpsert,
  AdjacentItemAnchor,
  AdjacentItemRef,
  AdjacentItemsResult,
  ItemIdRewriteMapping,
  SyncReport,
  UpsertItemInput,
  VaultContext,
  VaultDirEntry,
  VaultIndexAdapter,
  VaultItemMetaRead,
  VaultItemSourceRefRead,
  VaultItemStatMeta,
} from "./adapters/types.js";

export {
  basename,
  dirname,
  isMarkdownItemFile,
  isReservedVaultEntry,
  isUuidMarkdownBasename,
  itemCoverPath,
  itemCoverRelativePath,
  itemCoverSizePath,
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
  noteSharedMediaRoot,
  noteUuidFromItemPath,
  normalizeRelativePath,
  RECONCILE_TOUCH_FILE,
  vaultMetaPath,
  vaultsRoot,
  vaultRoot,
} from "./vault/paths.js";

export {
  listFolderRelativePaths,
  listItemRelativePaths,
  listItemRelativePathsUnderPrefix,
} from "./vault/scan.js";

export {
  ensureTagsByName,
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  readItemContent,
  readItemDocument,
  readItemFile,
  readItemRawMarkdown,
  readItemSourceRef,
  readVaultMeta,
  writeItemContent,
  writeItemDocument,
  writeItemFile,
  writeItemSourceRef,
  writeVaultMeta,
  type TagMaps,
  type TagMapsHolder,
} from "./vault/item-io.js";


export {
  embeddingRefreshInputFromItem,
  flushEmbeddingRefresh,
  refreshItemEmbeddingAfterWrite,
  tagNamesForItem,
} from "./vault/item-embedding-refresh.js";

export {
  refreshItemIndexAfterWrite,
  upsertItemIndexFromVault,
  type ItemIndexRefreshOutcome,
} from "./vault/item-index-refresh.js";

export {
  buildTagMaps,
  parseItemDocument,
  parseItemDocumentResolved,
  serializeItemDocument,
} from "./vault/item-document.js";

export {
  buildCanonicalFrontmatter,
  contentTypeFromFrontmatter,
  demoteFrontmatterKey,
  extractUnknownFrontmatterKeys,
  ftsFieldsFromDocumentMarkdown,
  bumpContentRevisionInDocumentMarkdown,
  parseDocumentMarkdown,
  parseKnownFrontmatter,
  partitionDocumentFrontmatter,
  resolveFrontmatterDates,
  serializeDocumentMarkdown,
} from "./vault/frontmatter.js";
export type { PartitionedFrontmatter } from "./vault/frontmatter.js";

export { createVault } from "./vault/vault-operations.js";
export {
  deleteItem,
  listItemsByIds,
  listItemsOnDisk,
  streamItemsByIds,
  upsertItem,
  writeItemRawMarkdown,
} from "./vault/item-operations.js";
export type {
  StreamedItemRead,
  StreamItemsByIdsOptions,
} from "./vault/item-operations.js";
export { syncIndexFromFilesystem } from "./vault/sync-operations.js";

export { syncIndexItemsFromFilesystem } from "./vault/item-index-sync.js";

export {
  isStaleItemDerivedLocalizeJob,
  runItemDerivedLocalizeRefresh,
} from "./vault/item-derived-localize.js";
export type {
  ItemDerivedLocalizeRefreshInput,
  ItemDerivedLocalizeRefreshOutcome,
  LocalizeRemoteDisplayAssetsPort,
} from "./vault/item-derived-localize.js";

export {
  createVaultWatchBatcher,
  dedupeVaultWatchItemIds,
} from "./vault/vault-watch-batch.js";
export type {
  VaultWatchBatch,
  VaultWatchBatcher,
} from "./vault/vault-watch-batch.js";

export {
  classifyVaultWatchPath,
  parseSharedMediaNoteUuid,
  parseVaultItemWatchPath,
  resolveVaultItemWatchPath,
  resolveVaultWatchTarget,
} from "./vault/vault-watch-path.js";
export type { VaultWatchTarget } from "./vault/vault-watch-path.js";

export { reconcileIndexFolderPrefixFromFilesystem } from "./vault/folder-prefix-index-sync.js";

export {
  createSingleFlight,
  DISK_ITEM_READ_CONCURRENCY,
  INDEX_SYNC_YIELD_MS,
  runWithConcurrency,
  yieldToEventLoop,
} from "./util/concurrency.js";

export { createTwoPhaseBootGate } from "./util/boot-gate.js";
export type { TwoPhaseBootGate } from "./util/boot-gate.js";

export { formatIndexingBannerLabel } from "./util/indexing-banner.js";
export type {
  IndexBannerInput,
  IndexBannerStatus,
} from "./util/indexing-banner.js";

export { formatDerivedCatchUpBannerLabel } from "./util/derived-catch-up-banner.js";

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
  listFolderItems,
  listFolderTree,
  listFolderTreeFromIndex,
  reconcileFolderTreeFromDisk,
  buildFolderTreeFromSources,
  readVaultFolderPaths,
  moveItemToFolder,
  renameFolder,
} from "./vault/folder-operations.js";
export type { FolderTreeNode } from "./vault/folder-tree.js";
export { renameFolderPath } from "./vault/folder-tree.js";
export {
  ensureInboxLayout,
  resolveOrCreateInboxFolder,
} from "./vault/inbox-layout.js";
export {
  classifyDropFilename,
  titleStemFromFilename,
} from "./vault/drop-import-classify.js";
export { resolveDropTitle } from "./vault/resolve-drop-title.js";
export type { DropImportClass } from "./vault/drop-import-classify.js";

export {
  listTagsWithCounts,
  syncTagsToIndex,
} from "./vault/tag-operations.js";
export type { TagWithCount } from "./vault/tag-operations.js";
export {
  attachMediaFile,
  deleteMediaFile,
  listItemMediaWithPaths,
  replaceMediaFile,
  syncItemMediaToIndex,
} from "./vault/media-operations.js";
export type { MediaWithPath } from "./vault/media-operations.js";
export {
  bareMediaFileId,
  findFirstGalleryImagePath,
  findFirstGalleryVideoPath,
  listMediaFiles,
  mediaFilePath,
} from "./vault/media-io.js";
export {
  applyItemCover,
  clearItemCover,
  readItemCoverSize,
  resolveItemThumbnailAbsolutePath,
  touchItemUpdatedAt,
  writeItemCoverSize,
} from "./vault/cover-operations.js";
export {
  resolveItemThumbnailPathsBatch,
  resolveItemThumbnailPathsProgressive,
} from "./vault/thumbnail-resolve.js";
export type {
  ResolveItemThumbnailPathsProgressiveOptions,
  ThumbnailResolveItem,
  ThumbnailResolveResult,
} from "./vault/thumbnail-resolve.js";
export {
  isRemoteHttpUrl,
  normalizeRemoteHttpUrl,
  parseYouTubeVideoId,
  youtubeTeaserDownloadUrl,
} from "./vault/youtube-video-id.js";
export {
  extractMarkdownRemoteImageRefs,
  filenameFromRemoteImageUrl,
  localizeRemoteDisplayAssets,
  mightNeedRemoteDisplayAssetLocalization,
  rewriteMarkdownRemoteImageUrls,
} from "./vault/remote-display-assets.js";
export type {
  EncodeCoverWebp,
  FetchRemoteBytes,
  LocalizeRemoteDisplayAssetsOptions,
  LocalizeRemoteDisplayAssetsResult,
  MarkdownRemoteImageRef,
} from "./vault/remote-display-assets.js";
export { resolveItemHeroMedia } from "./vault/hero-image-resolve.js";
export type {
  ItemHeroMedia,
  ItemHeroMediaKind,
} from "./vault/hero-image-resolve.js";
export { vaultHasLegacyItemsLayout } from "./vault/assert-vault-layout.js";
export {
  allocateUuidMarkdownName,
  inspectVaultLayout,
  remediateVaultLayout,
} from "./vault/vault-layout-guard.js";
export type {
  RemediateVaultLayoutOptions,
  VaultLayoutInspectReport,
  VaultLayoutRemediateReport,
} from "./vault/vault-layout-guard.js";

export {
  migrateSidecarMediaToShared,
  preflightSidecarMediaMigrate,
} from "./vault/sidecar-media-migrate.js";
export type {
  SidecarMediaMigratePreflight,
  SidecarMediaMigrateProgress,
  SidecarMediaMigrateReport,
} from "./vault/sidecar-media-migrate.js";

export {
  assertNoIncompleteVaultDirs,
  listIncompleteVaultDirIds,
  persistActiveVaultIdSetting,
  runEmptyVaultBootstrap,
  withVaultBootstrapLock,
} from "./vault/bootstrap-vault.js";

export { SqlVaultIndexAdapter, SqlVaultIndexStore } from "./index/sql-index.js";
export type { SqlSelector } from "./index/sql-index.js";

export type {
  ItemEmbeddingRefreshInput,
  ItemEmbeddingsPort,
} from "./adapters/types.js";
export {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_ID,
  planEmbeddingReconcileTick,
} from "./embeddings/index.js";
export type {
  EmbeddingEngine,
  EmbeddingReconcileTickOptions,
  EmbeddingReconcileTickResult,
  EmbeddingReconcileTickStats,
  SimilarItemHit,
} from "./embeddings/index.js";
export { extractTextLinks } from "./links/extract-text-links.js";
export type {
  ExtractedTextLink,
  TextLinkKind,
} from "./links/extract-text-links.js";

export { resolveTextLinks } from "./links/resolve-text-links.js";
export type {
  ResolvedTextLink,
  TextLinkResolveContext,
  TextLinkResolveStatus,
} from "./links/resolve-text-links.js";

export { parseAndResolveTextLinks } from "./links/parse-text-links.js";

export { collectOutboundLinks } from "./links/collect-outbound-links.js";
export type {
  OutboundLinkScope,
  OutboundTextLink,
} from "./links/collect-outbound-links.js";

export {
  buildBacklinkReverseMap,
  collectBacklinkSources,
} from "./links/collect-backlink-sources.js";
export type {
  BacklinkSource,
  BacklinkSourceBody,
} from "./links/collect-backlink-sources.js";

export { textEdgeRowsFromBody } from "./edges/text-edge-rows.js";
export { canonicalUserEdgePair } from "./edges/user-edge-canonical.js";
export {
  addUserEdge,
  listTextBacklinkSources,
  listUserEdges,
  removeUserEdge,
  replaceTextEdgesForItem,
  rewriteItemEdgeIds,
} from "./edges/sql-item-edges.js";
export type {
  ItemEdgeInsertRow,
  ItemEdgeKind,
  ItemEdgeSource,
  UserEdgeNeighbor,
} from "./edges/types.js";

export {
  buildTextLinkResolveContext,
  textLinkCatalogIndexesFromItems,
  textLinkResolveContextFromIndexes,
  textLinkResolveContextFromItems,
} from "./links/text-links-reindex.js";
export type { TextLinkCatalogIndexes } from "./links/text-links-reindex.js";

export {
  invalidateAllVaultIdTitleCatalogs,
  invalidateVaultIdTitleCatalog,
  loadVaultIdTitleCatalog,
} from "./links/vault-id-title-catalog.js";
export type { VaultIdTitleRow } from "./links/vault-id-title-catalog.js";

export {
  COLLECTOR_UNRESOLVED_HREF_PREFIX,
  decodeItemPathHref,
  itemPathHref,
  rewriteTextLinksForMarkdown,
} from "./links/rewrite-text-links.js";

export {
  DEFAULT_ITEM_ID_SORT,
  ITEM_ID_SORT_KEYS,
  isItemIdSortDir,
  isItemIdSortKey,
  primarySortDirForKey,
  resolveItemIdOrderByClause,
} from "./index/item-id-sort.js";
export type { ItemIdSort, ItemIdSortDir } from "./index/item-id-sort.js";

export {
  createDefaultAppSettings,
  mergeAppSettings,
  readAppSettings,
  writeAppSettings,
  appSettingsPath,
} from "./settings/app-settings-io.js";

export {
  migrateLegacyUnifiedProfileLayout,
} from "./settings/profile-layout-migrate.js";
export type { ProfileLayoutMigrationResult } from "./settings/profile-layout-migrate.js";

export {
  clearDashboardSnapshot,
  dashboardSnapshotPath,
  readDashboardSnapshot,
  writeDashboardSnapshot,
} from "./settings/dashboard-snapshot-io.js";
