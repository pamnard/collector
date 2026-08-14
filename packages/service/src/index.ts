/**
 * @collector/service — in-process Collector service application module.
 *
 * Browser UI must import only from this entry. Node host lives at
 * `@collector/service/host` so Vite does not pull `node:fs` into the client.
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
  createVaultPresentationChangedStore,
  type VaultPresentationChangedPayload,
  type VaultPresentationChangedStore,
} from "./vault-presentation-changed.js";

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

export {
  createDropImportService,
  prepareDroppedNoteMarkdown,
  resolveImportItemFolder,
  type DropImportService,
  type DropImportServiceDeps,
} from "./drop-import.js";

export {
  createSyncPluginHandoff,
  type SyncPluginHandoff,
  type SyncPluginHandoffDeps,
  type SyncPluginImportResult,
} from "./sync-plugin-handoff.js";

export {
  runSyncPluginCycle,
  type RunSyncPluginCycleInput,
  type RunSyncPluginCycleResult,
} from "./sync-plugin-cycle.js";

export {
  createMockSyncPlugin,
  type MockSyncPlugin,
  type MockSyncPluginOptions,
} from "./sync-plugin-mock.js";

export {
  createSyncPluginRegistry,
  MOCK_SYNC_PLUGIN_ID,
  SYNC_PLUGIN_STATE_DIR,
  type SyncPluginRegistryDeps,
} from "./sync-plugin-registry.js";

export {
  createSyncPluginWakeController,
  type SyncPluginWakeController,
  type SyncPluginWakeControllerDeps,
  type SyncPluginWakePolicy,
} from "./sync-plugin-wake.js";

export {
  TELEGRAM_PLUGIN_ID,
  TELEGRAM_BOT_TOKEN_KEY,
  createTelegramSyncPlugin,
  createTelegramSyncService,
  createTelegramBotApi,
} from "./plugins/telegram/index.js";
