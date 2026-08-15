/**
 * Sole domain runtime for vault-index sync / watcher / SQLite (#328).
 *
 * Service host (desktop wire, CLI, MCP) composes this once. UI is a thin
 * client over the host — do not re-create sync/watcher orchestration in the UI.
 *
 * Bootstrap/lifecycle composition root; focused modules live as siblings (#419).
 */

import {
  SqlVaultIndexStore,
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
  migrateLegacyUnifiedProfileLayout,
  resolveItemThumbnailPathsBatch,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import type { CollectorProfileLayout } from "@collector/shared";
import { createAppSettingsService } from "../app-settings.js";
import {
  createCredentialsService,
  createOsKeychainBackend,
} from "../credentials.js";
import { createCollectorIndexBoot } from "../index-boot.js";
import { createDashboardSnapshotService } from "../dashboard-snapshot.js";
import { createItemsSearchService } from "../items-search.js";
import { createItemEmbeddingsService } from "../embeddings/item-embeddings-service.js";
import { createMediaCoverService } from "../media-cover.js";
import { createDropImportService } from "../drop-import.js";
import { createTagsFoldersService } from "../tags-folders.js";
import { createVaultsService } from "../vaults.js";
import type {
  SyncPluginWakePolicy,
  SyncPluginWakeController,
} from "../sync-plugin-wake.js";
import type {
  ImportDroppedFilesInput,
  SyncPluginsPort,
  TelegramSyncPort,
} from "@collector/api";
import {
  createVaultIndexSyncStatusStore,
  type VaultIndexSyncStatusStore,
} from "../sync-status.js";
import { createVaultPresentationChangedStore } from "../vault-presentation-changed.js";
import { generateCoverFromMedia } from "./node-cover.js";
import { NodeSqliteExecutor } from "./node-sql.js";
import { createNodeVaultFilesystemWatcher } from "./vault-fs-watcher.js";
import { createVaultLayoutGuardRunner } from "../vault-layout-guard-runner.js";
import {
  createHostJobRegistry,
  createJobQueue,
  type JobQueue,
} from "../jobs/job-queue.js";
import { createJobPermanentFailureStore, reportEnqueueFailure } from "../job-permanent-failure.js";
import { phaseBHandlerBindings } from "../jobs/phase-b-bindings.js";
import {
  createVaultIndexSyncHandler,
} from "../jobs/handlers/vault-index-sync.js";
import {
  createReindexVaultBatchHandler,
  enqueueReindexVaultBatch,
} from "../jobs/handlers/reindex-vault-batch.js";
import {
  createRefreshEmbeddingsHandler,
  enqueueRefreshEmbeddings,
} from "../jobs/handlers/refresh-embeddings.js";
import { enqueueAndAwaitResult, waitForJobTerminal } from "../jobs/job-wait.js";
import {
  createGenerateCoverHandler,
  enqueueGenerateCover,
} from "../jobs/handlers/generate-cover.js";
import {
  createDropImportBatchHandler,
  enqueueDropImportBatch,
  takeDropImportResult,
} from "../jobs/handlers/drop-import-batch.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createVaultIndexSyncController,
  type VaultSyncListener,
} from "./domain-runtime-vault-sync.js";
import { createDomainRuntimeSyncPlugins } from "./domain-runtime-sync-plugins.js";

export interface ServiceDomainRuntime {
  dataDir: string;
  open: () => Promise<void>;
  ensureInitialized: () => Promise<void>;
  isHealthy: () => boolean;
  close: () => Promise<void>;
  vaultIndexSyncStatus: VaultIndexSyncStatusStore;
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
  dropImport: ReturnType<typeof createDropImportService>;
  vaults: ReturnType<typeof createVaultsService>;
  appSettings: ReturnType<typeof createAppSettingsService>;
  credentials: ReturnType<typeof createCredentialsService>;
  syncPlugins: SyncPluginsPort;
  telegramSync: TelegramSyncPort;
  syncPluginWake: SyncPluginWakeController;
  dashboardSnapshot: ReturnType<typeof createDashboardSnapshotService>;
  /** Durable background job queue (#628). Host-internal. */
  jobs: JobQueue;
  /** Permanent job failure fan-out (#630). */
  jobPermanentFailure: ReturnType<typeof createJobPermanentFailureStore>;
}

export interface ServiceDomainRuntimeOptions {
  /** Build-time wake policies (#31). Default: none registered. */
  wakePolicies?: Record<string, SyncPluginWakePolicy>;
}

export function createServiceDomainRuntime(
  layout: CollectorProfileLayout,
  options: ServiceDomainRuntimeOptions = {},
): ServiceDomainRuntime {
  const fs = new NodeFileSystemAdapter();
  const { dataDir, configDir, indexDbPath: dbPath, jobsDbPath } = layout;

  const syncedVaultIds = new Set<string>();
  const vaultSyncPromises = new Map<string, Promise<void>>();
  const vaultSyncListeners = new Map<string, Set<VaultSyncListener>>();
  const vaultIndexSyncStatus = createVaultIndexSyncStatusStore();
  const vaultPresentationChanged = createVaultPresentationChangedStore();
  const jobPermanentFailure = createJobPermanentFailureStore();
  const watcherDisabledVaultIds = new Set<string>();
  let runtimeClosed = false;
  let jobsQueue: JobQueue | null = null;

  function requireJobs(): JobQueue {
    if (!jobsQueue) {
      throw new Error("Job queue is not open");
    }
    return jobsQueue;
  }

  const jobs: JobQueue = {
    enqueue: (input) => requireJobs().enqueue(input),
    cancel: (id) => requireJobs().cancel(id),
    getJob: (id) => requireJobs().getJob(id),
    stats: () => requireJobs().stats(),
    start: () => requireJobs().start(),
    stop: () => requireJobs().stop(),
  };

  const vaultsHolder: {
    current: ReturnType<typeof createVaultsService> | null;
  } = { current: null };

  let forceVaultIndexResync: (
    vaultId: string,
    vaultPath: string,
    options?: { restartWatcher?: boolean },
  ) => void = () => {
    throw new Error("forceVaultIndexResync not initialized");
  };

  const vaultLayoutGuard = createVaultLayoutGuardRunner({
    getContext: () => getContext(),
    onComplete: (vaultId, vaultPath) => {
      forceVaultIndexResync(vaultId, vaultPath, { restartWatcher: false });
    },
    onError: (vaultId, error) => {
      console.error("[collector] vault layout guard failed:", vaultId, error);
    },
  });

  const vaultFsWatcher = createNodeVaultFilesystemWatcher({
    getContext: () => getContext(),
    getActiveVaultId: () =>
      vaultsHolder.current?.getActiveVaultEntry()?.meta.id ?? null,
    enqueueReindexVaultBatch: (payload) =>
      enqueueReindexVaultBatch(requireJobs(), payload),
    forceVaultIndexResync: (vaultId, vaultPath) => {
      forceVaultIndexResync(vaultId, vaultPath);
    },
    onEnqueueFailure: (error) => {
      reportEnqueueFailure(jobPermanentFailure, "reindexVaultBatch", error);
    },
  });

  const appSettings = createAppSettingsService({
    fs,
    ensureConfigDir: async () => {
      await mkdir(configDir, { recursive: true });
      return configDir;
    },
    isDevMock: () => false,
    readLegacySettings: () => ({}),
    readDevMockSettings: () => null,
    writeDevMockSettings: () => {
      throw new Error("dev mock settings are not supported in service host");
    },
  });

  const dashboardSnapshot = createDashboardSnapshotService({
    fs,
    ensureConfigDir: async () => {
      await mkdir(configDir, { recursive: true });
      return configDir;
    },
    isDevMock: () => false,
    readDevMockSnapshot: () => null,
    writeDevMockSnapshot: () => {
      throw new Error("dev mock snapshot is not supported in service host");
    },
  });

  const indexBoot = createCollectorIndexBoot({
    prepareEnvironment: async () => {
      await mkdir(dataDir, { recursive: true });
      await mkdir(configDir, { recursive: true });
      await migrateLegacyUnifiedProfileLayout(fs, layout);
    },
    openSql: async () => NodeSqliteExecutor.open(dbPath),
    onUnhealthyRebuildStart: async () => {
      const pending = [...vaultSyncPromises.values()];
      await Promise.allSettled(pending);
      syncedVaultIds.clear();
      vaultSyncPromises.clear();
      vaultSyncListeners.clear();
      watcherDisabledVaultIds.clear();
      vaultsHolder.current?.clearActiveVault();
      await vaultFsWatcher.stop();
      vaultIndexSyncStatus.set({
        vaultId: null,
        status: "rebuilding",
        progress: null,
        metadataReady: false,
        ftsReady: false,
      });
      await dashboardSnapshot.clearDashboardSnapshot();
    },
    onUnhealthyRebuildFinally: () => {
      if (vaultIndexSyncStatus.get().status === "rebuilding") {
        vaultIndexSyncStatus.set({
          vaultId: null,
          status: "idle",
          progress: null,
          metadataReady: false,
          ftsReady: false,
        });
      }
    },
  });

  function getIndex(): SqlVaultIndexStore {
    const session = indexBoot.getSql();
    if (!session || !indexBoot.isHealthy()) {
      throw new Error("Collector database is not initialized");
    }
    return new SqlVaultIndexStore(session);
  }

  const itemEmbeddings = createItemEmbeddingsService({
    getDb: () => {
      const session = indexBoot.getSql();
      if (!session || !indexBoot.isHealthy()) {
        throw new Error("Collector database is not initialized");
      }
      return session;
    },
  });

  function getContext() {
    return {
      fs,
      index: getIndex(),
      embeddings: itemEmbeddings,
      embeddingRefreshJobs: {
        enqueue: async (
          vaultId: string,
          inputs: import("@collector/core").ItemEmbeddingRefreshInput[],
        ) => {
          if (inputs.length === 0) {
            return;
          }
          await enqueueRefreshEmbeddings(requireJobs(), { vaultId, inputs });
        },
      },
    };
  }

  async function ensureInitialized(): Promise<void> {
    await indexBoot.ensureHealthy();
  }

  const vaultIndexSync = createVaultIndexSyncController({
    syncedVaultIds,
    vaultSyncPromises,
    vaultSyncListeners,
    vaultIndexSyncStatus,
    watcherDisabledVaultIds,
    isRuntimeClosed: () => runtimeClosed,
    getContext,
    vaultFsWatcher,
    requireJobs,
    jobPermanentFailure,
    scheduleVaultLayoutGuard: (vaultId, vaultPath) => {
      vaultLayoutGuard.schedule(vaultId, vaultPath);
    },
  });

  forceVaultIndexResync = vaultIndexSync.forceVaultIndexResync;

  const {
    addVaultSyncListener,
    notifyWatchItemsSynced,
    startVaultIndexSync,
    kickoffVaultIndexSync,
    isVaultFtsReady,
  } = vaultIndexSync;

  phaseBHandlerBindings.vaultIndexSync = createVaultIndexSyncHandler({
    startVaultIndexSync,
  });
  phaseBHandlerBindings.reindexVaultBatch = createReindexVaultBatchHandler({
    getContext,
    onItemsSynced: notifyWatchItemsSynced,
    onWatchApplied: (vaultId, vaultPath) => {
      vaultLayoutGuard.schedule(vaultId, vaultPath);
    },
  });

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
    ensureInitialized,
    getDataDir: () => dataDir,
    getContext,
    ensureAppSettings: () => appSettings.ensureAppSettings(),
    updateAppSettings: (patch) => appSettings.updateAppSettings(patch),
    clearDashboardSnapshot: () => dashboardSnapshot.clearDashboardSnapshot(),
    stopVaultFilesystemWatcher: () => vaultFsWatcher.stop(),
    enableVaultWatcher: (vaultId) => {
      watcherDisabledVaultIds.delete(vaultId);
    },
  });
  vaultsHolder.current = vaults;

  const itemsSearch = createItemsSearchService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext,
    getIndex,
    kickoffVaultIndexSync,
    buildSearchFtsQuery,
    addVaultSyncListener,
    onVaultPresentationChanged: (vaultId) =>
      vaultPresentationChanged.notify(vaultId),
    findSimilarItems: (itemId, limit) =>
      itemEmbeddings.findSimilarItems(itemId, limit),
  });

  const tagsFolders = createTagsFoldersService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext,
    kickoffVaultIndexSync,
    addVaultSyncListener,
    onVaultPresentationChanged: (vaultId) =>
      vaultPresentationChanged.notify(vaultId),
  });

  const mediaCover = createMediaCoverService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext,
    enqueueGenerateCover: (input) => enqueueGenerateCover(requireJobs(), input),
    waitForCoverJob: (jobId) => waitForJobTerminal(requireJobs(), jobId),
    resolveThumbnailPathsBatch: (vaultPath, items) =>
      resolveItemThumbnailPathsBatch(getContext().fs, vaultPath, items),
    onVaultPresentationChanged: (vaultId) =>
      vaultPresentationChanged.notify(vaultId),
  });

  async function requireActiveVaultPath(vaultId: string): Promise<string> {
    const active = await vaults.resolveActiveVault();
    if (active.vault.id !== vaultId) {
      throw new Error(`active vault mismatch for job: ${vaultId}`);
    }
    return active.path;
  }

  phaseBHandlerBindings.generateCover = createGenerateCoverHandler({
    getContext,
    resolveVaultPath: requireActiveVaultPath,
    generateCoverFromMedia,
    onVaultPresentationChanged: (vaultId) =>
      vaultPresentationChanged.notify(vaultId),
  });

  phaseBHandlerBindings.refreshEmbeddings = createRefreshEmbeddingsHandler({
    refresh: (inputs) => itemEmbeddings.refresh(inputs),
  });

  phaseBHandlerBindings.dropImportBatch = createDropImportBatchHandler({
    createItem: (input) => itemsSearch.createItem(input),
    attachMediaFiles: (itemId, files) =>
      mediaCover.attachMediaFiles(itemId, files),
    updateItemSource: (itemId, raw) =>
      itemsSearch.updateItemSource(itemId, raw),
  });

  const dropImport = {
    async importDroppedFiles(input: ImportDroppedFilesInput) {
      const active = await vaults.resolveActiveVault();
      const stagingDir = join(
        dataDir,
        "drop-import-staging",
        crypto.randomUUID(),
      );
      await mkdir(stagingDir, { recursive: true });
      const paths: string[] = [];
      try {
        for (const file of input.files) {
          const rel = file.relativePath.replace(/\\/g, "/");
          const dest = join(stagingDir, rel);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, file.bytes);
          paths.push(dest);
        }
        if (paths.length === 0) {
          return { createdIds: [] };
        }
        return enqueueAndAwaitResult({
          queue: requireJobs(),
          label: "dropImportBatch",
          takeResult: takeDropImportResult,
          acceptFailed: true,
          enqueue: () =>
            enqueueDropImportBatch(requireJobs(), {
              vaultId: active.vault.id,
              stagingDir,
              paths,
              targetFolderId: input.folder_path?.trim() || null,
            }),
        });
      } finally {
        await rm(stagingDir, { recursive: true, force: true });
      }
    },
  };

  const credentials = createCredentialsService({
    backend: createOsKeychainBackend(),
  });

  const resolveActiveVaultId = async () => {
    const { vault } = await vaults.resolveActiveVault();
    return vault.id;
  };

  const { syncPlugins, telegramSync, syncPluginWake } =
    createDomainRuntimeSyncPlugins({
      credentials,
      fs,
      dataDir,
      resolveActiveVaultId,
      listFolderTree: () => tagsFolders.listFolderTree(),
      createItem: (input) => itemsSearch.createItem(input),
      attachMediaFiles: (itemId, files) =>
        mediaCover.attachMediaFiles(itemId, files),
      requireJobs,
      jobPermanentFailure,
      wakePolicies: options.wakePolicies,
    });

  return {
    dataDir,
    async open() {
      await indexBoot.open();
      if (!jobsQueue) {
        jobsQueue = await createJobQueue({
          dbPath: jobsDbPath,
          registry: createHostJobRegistry(),
          onPermanentFailure: (info) => {
            jobPermanentFailure.notify(info);
          },
        });
        jobsQueue.start();
      }
    },
    ensureInitialized,
    isHealthy: () => indexBoot.isHealthy(),
    async close() {
      runtimeClosed = true;
      vaultLayoutGuard.dispose();
      syncPluginWake.dispose();
      await Promise.allSettled([...vaultSyncPromises.values()]);
      await vaultFsWatcher.stop();
      if (jobsQueue) {
        await jobsQueue.stop();
        jobsQueue = null;
      }
      const sql = indexBoot.getSql();
      if (sql) {
        await sql.close();
      }
    },
    vaultIndexSyncStatus,
    vaultPresentationChanged,
    startVaultFilesystemWatcher: (vaultId, vaultPath) =>
      vaultFsWatcher.start(vaultId, vaultPath),
    stopVaultFilesystemWatcher: () => vaultFsWatcher.stop(),
    isVaultFilesystemWatcherActive: () => vaultFsWatcher.isWatching(),
    itemsSearch,
    tagsFolders,
    mediaCover,
    dropImport,
    vaults,
    appSettings,
    credentials,
    syncPlugins,
    telegramSync,
    syncPluginWake,
    dashboardSnapshot,
    jobs,
    jobPermanentFailure,
  };
}
