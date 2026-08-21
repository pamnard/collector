import {
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
  resolveItemThumbnailPathsBatch,
  type SqlVaultIndexStore,
  type IndexSyncProgress,
} from "@collector/core";
import { normalizeMarkdown } from "@collector/core/node";
import type { createAppSettingsService } from "../../app-settings.js";
import type { createDashboardSnapshotService } from "../../dashboard-snapshot.js";
import type { createVaultPresentationChangedStore } from "../../vault-presentation-changed.js";
import type { createItemEmbeddingsService } from "../../embeddings/item-embeddings-service.js";
import type { JobQueue } from "../../jobs/job-queue.js";
import { createItemsSearchService } from "../../items-search.js";
import { createTagsFoldersService } from "../../tags-folders.js";
import { createMediaCoverService } from "../../media-cover.js";
import { createVaultsService } from "../../vaults.js";
import { enqueueGenerateCover } from "../../jobs/handlers/generate-cover.js";
import { waitForJobTerminal } from "../../jobs/job-wait.js";
import { createLocalizeItemRemoteDisplayAssets } from "../../localize-item-remote-display-assets.js";

export interface DomainServicesDeps {
  dataDir: string;
  ensureInitialized: () => Promise<void>;
  getContext: () => import("@collector/core").VaultContext;
  getIndex: () => SqlVaultIndexStore;
  itemEmbeddings: ReturnType<typeof createItemEmbeddingsService>;
  appSettings: ReturnType<typeof createAppSettingsService>;
  dashboardSnapshot: ReturnType<typeof createDashboardSnapshotService>;
  vaultFsWatcher: { stop: () => Promise<void> };
  vaultSync: {
    syncedVaultIds: Set<string>;
    watcherDisabledVaultIds: Set<string>;
    kickoffVaultIndexSync: (vaultId: string, vaultPath: string) => void;
    addVaultSyncListener: (
      vaultId: string,
      listener: {
        onBatch?: (p: IndexSyncProgress) => void;
        onComplete?: () => void;
      },
    ) => () => void;
  };
  vaultPresentationChanged: ReturnType<typeof createVaultPresentationChangedStore>;
  requireJobs: () => JobQueue;
}

export interface DomainServices {
  vaults: ReturnType<typeof createVaultsService>;
  itemsSearch: ReturnType<typeof createItemsSearchService>;
  tagsFolders: ReturnType<typeof createTagsFoldersService>;
  mediaCover: ReturnType<typeof createMediaCoverService>;
  buildSearchFtsQuery: (userQuery: string, vaultId: string) => string | null;
}

export function createDomainServices(deps: DomainServicesDeps): DomainServices {
  function isVaultFtsReady(vaultId: string): boolean {
    return deps.vaultSync.syncedVaultIds.has(vaultId);
  }

  function buildSearchFtsQuery(userQuery: string, vaultId: string): string | null {
    const trimmed = userQuery.trim();
    if (!trimmed) {
      return null;
    }
    if (isVaultFtsReady(vaultId)) {
      return buildFtsMatchQuery(trimmed);
    }
    return buildMetadataFtsMatchQuery(trimmed);
  }

  const vaults = createVaultsService({
    ensureInitialized: deps.ensureInitialized,
    getDataDir: () => deps.dataDir,
    getContext: deps.getContext,
    ensureAppSettings: () => deps.appSettings.ensureAppSettings(),
    updateAppSettings: (patch) => deps.appSettings.updateAppSettings(patch),
    clearDashboardSnapshot: () => deps.dashboardSnapshot.clearDashboardSnapshot(),
    stopVaultFilesystemWatcher: () => deps.vaultFsWatcher.stop(),
    enableVaultWatcher: (vaultId) => {
      deps.vaultSync.watcherDisabledVaultIds.delete(vaultId);
    },
  });

  const itemsSearch = createItemsSearchService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext: deps.getContext,
    getIndex: deps.getIndex,
    kickoffVaultIndexSync: deps.vaultSync.kickoffVaultIndexSync,
    buildSearchFtsQuery,
    addVaultSyncListener: deps.vaultSync.addVaultSyncListener,
    onVaultPresentationChanged: (vaultId) =>
      deps.vaultPresentationChanged.notify(vaultId),
    findSimilarItems: (itemId, limit) =>
      deps.itemEmbeddings.findSimilarItems(itemId, limit),
    normalizeMarkdown,
    localizeRemoteDisplayAssets: createLocalizeItemRemoteDisplayAssets({
      getContext: deps.getContext,
      resolveActiveVault: () => vaults.resolveActiveVault(),
    }),
  });

  const tagsFolders = createTagsFoldersService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext: deps.getContext,
    kickoffVaultIndexSync: deps.vaultSync.kickoffVaultIndexSync,
    addVaultSyncListener: deps.vaultSync.addVaultSyncListener,
    onVaultPresentationChanged: (vaultId) =>
      deps.vaultPresentationChanged.notify(vaultId),
  });

  const mediaCover = createMediaCoverService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext: deps.getContext,
    enqueueGenerateCover: (input) => enqueueGenerateCover(deps.requireJobs(), input),
    waitForCoverJob: (jobId) => waitForJobTerminal(deps.requireJobs(), jobId),
    resolveThumbnailPathsBatch: (vaultPath, items) =>
      resolveItemThumbnailPathsBatch(deps.getContext().fs, vaultPath, items),
    onVaultPresentationChanged: (vaultId) =>
      deps.vaultPresentationChanged.notify(vaultId),
  });

  return {
    vaults,
    itemsSearch,
    tagsFolders,
    mediaCover,
    buildSearchFtsQuery,
  };
}
