/**
 * @collector/service — in-process Collector service application module.
 */

export {
  createCollectorIndexBoot,
  type ClosableSqlExecutor,
  type CollectorIndexBoot,
  type CollectorIndexBootDeps,
} from "./index-boot.js";

export {
  createItemsSearchService,
  queryDashboardIndexPage,
  DASHBOARD_PREFETCH_SIZE,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type ItemsIndexPort,
  type ItemsSearchService,
  type ItemsSearchServiceDeps,
  type VaultSyncBatchListener,
} from "./items-search.js";

export {
  createTagsFoldersService,
  type ServiceSubscribeHandlers,
  type TagsFoldersService,
  type TagsFoldersServiceDeps,
} from "./tags-folders.js";

export {
  createMediaCoverService,
  type GenerateCoverFromMedia,
  type MediaCoverService,
  type MediaCoverServiceDeps,
  type ResolveThumbnailPathsBatch,
} from "./media-cover.js";

export {
  createVaultIndexSyncStatusStore,
  type VaultIndexSyncStatus,
  type VaultIndexSyncStatusStore,
} from "./sync-status.js";

export {
  createAppSettingsService,
  type AppSettingsService,
  type AppSettingsServiceDeps,
} from "./app-settings.js";

export {
  createDashboardSnapshotService,
  type DashboardSnapshotService,
  type DashboardSnapshotServiceDeps,
} from "./dashboard-snapshot.js";

export {
  createVaultsService,
  type VaultEntry,
  type VaultsService,
  type VaultsServiceDeps,
} from "./vaults.js";
