import type { SyncPluginsPort, TelegramSyncPort } from "@collector/api";
import type { createAppSettingsService } from "../../app-settings.js";
import type { createCredentialsService } from "../../credentials.js";
import type { createDashboardSnapshotService } from "../../dashboard-snapshot.js";
import type { createDropImportRuntime } from "./drop-import.js";
import type { createItemsSearchService } from "../../items-search.js";
import type { createMediaCoverService } from "../../media-cover.js";
import type { createTagsFoldersService } from "../../tags-folders.js";
import type { createVaultsService } from "../../vaults.js";
import type { createJobPermanentFailureStore } from "../../job-permanent-failure.js";
import type { JobQueue } from "../../jobs/job-queue.js";
import type {
  SyncPluginWakeController,
} from "../../sync-plugin-wake.js";
import type { VaultIndexSyncStatusStore } from "../../sync-status.js";
import type { DerivedCatchUpStatusStore } from "../../derived-catch-up-status.js";
import type { createVaultPresentationChangedStore } from "../../vault-presentation-changed.js";

export interface ServiceDomainRuntime {
  dataDir: string;
  open: () => Promise<void>;
  ensureInitialized: () => Promise<void>;
  isHealthy: () => boolean;
  close: () => Promise<void>;
  vaultIndexSyncStatus: VaultIndexSyncStatusStore;
  derivedCatchUpStatus: DerivedCatchUpStatusStore;
  vaultPresentationChanged: ReturnType<
    typeof createVaultPresentationChangedStore
  >;
  startVaultFilesystemWatcher: (
    vaultId: string,
    vaultPath: string,
  ) => Promise<void>;
  stopVaultFilesystemWatcher: () => Promise<void>;
  isVaultFilesystemWatcherActive: () => boolean;
  itemsSearch: ReturnType<typeof createItemsSearchService>;
  tagsFolders: ReturnType<typeof createTagsFoldersService>;
  mediaCover: ReturnType<typeof createMediaCoverService>;
  dropImport: ReturnType<typeof createDropImportRuntime>;
  vaults: ReturnType<typeof createVaultsService>;
  appSettings: ReturnType<typeof createAppSettingsService>;
  credentials: ReturnType<typeof createCredentialsService>;
  syncPlugins: SyncPluginsPort;
  telegramSync: TelegramSyncPort;
  syncPluginWake: SyncPluginWakeController;
  dashboardSnapshot: ReturnType<typeof createDashboardSnapshotService>;
  jobs: JobQueue;
  jobPermanentFailure: ReturnType<typeof createJobPermanentFailureStore>;
}

export interface ServiceDomainRuntimeOptions {
  /** Build-time wake policies (#31). Default: none registered. */
  wakePolicies?: Record<string, import("../../sync-plugin-wake.js").SyncPluginWakePolicy>;
}
