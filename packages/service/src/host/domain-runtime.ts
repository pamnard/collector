/**
 * Sole domain runtime for vault-index sync / watcher / SQLite (#328).
 *
 * Service host (desktop wire, CLI, MCP) composes this once. UI is a thin
 * client over the host — do not re-create sync/watcher orchestration in the UI.
 */

import {
  SqlVaultIndexStore,
  migrateLegacyUnifiedProfileLayout,
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
import { createItemEmbeddingsService } from "../embeddings/item-embeddings-service.js";
import { createEmbeddingReconcileScheduler } from "../embeddings/embedding-reconcile-scheduler.js";
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
import { emptyStatusCounts } from "../jobs/job-store-types.js";
import { createJobPermanentFailureStore } from "../job-permanent-failure.js";
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
import {
  createItemDerivedRefreshHandler,
} from "../jobs/handlers/item-derived-refresh.js";
import {
  createItemExtractAutoHandler,
} from "../jobs/handlers/item-extract-auto.js";
import {
  createGenerateCoverHandler,
} from "../jobs/handlers/generate-cover.js";
import {
  createDropImportBatchHandler,
} from "../jobs/handlers/drop-import-batch.js";
import { createImportFolderHandler } from "../jobs/handlers/import-folder.js";
import { createLocalizeItemRemoteDisplayAssets } from "../localize-item-remote-display-assets.js";
import { reportEnqueueFailure } from "../job-permanent-failure.js";
import { createVaultIndexSyncStatusStore } from "../sync-status.js";
import {
  createDerivedCatchUpStatusRefresher,
  createDerivedCatchUpStatusStore,
} from "../derived-catch-up-status.js";
import { createDomainServices } from "./domain-runtime/domain-services.js";
import { enqueueItemDerivedRefreshWithFailureReporting } from "./domain-runtime/item-derived-refresh-enqueue.js";
import { createDropImportRuntime } from "./domain-runtime/drop-import.js";
import { createWaitDerivedRuntime } from "./domain-runtime/wait-derived.js";
import { createSyncPluginRuntime } from "./domain-runtime/sync-plugins.js";
import { createExtractPluginRegistry } from "../extract-plugin-registry.js";
import { createInstagramExtractorPlugin } from "../extract/instagram/instagram-extractor-plugin.js";
import {
  createVaultSyncController,
  type VaultSyncController,
} from "./domain-runtime/vault-sync-controller.js";
import type {
  ServiceDomainRuntime,
  ServiceDomainRuntimeOptions,
} from "./domain-runtime/types.js";
import { mkdir } from "node:fs/promises";

export type { ServiceDomainRuntime, ServiceDomainRuntimeOptions } from "./domain-runtime/types.js";

export function createServiceDomainRuntime(
  layout: CollectorProfileLayout,
  options: ServiceDomainRuntimeOptions = {},
): ServiceDomainRuntime {
  const fs = new NodeFileSystemAdapter();
  const { dataDir, configDir, indexDbPath: dbPath, jobsDbPath } = layout;

  const vaultIndexSyncStatus = createVaultIndexSyncStatusStore();
  const derivedCatchUpStatus = createDerivedCatchUpStatusStore();
  const vaultPresentationChanged = createVaultPresentationChangedStore();
  const jobPermanentFailure = createJobPermanentFailureStore();
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
    cancelPendingByIdempotencyKeyPrefix: (prefix) =>
      requireJobs().cancelPendingByIdempotencyKeyPrefix(prefix),
    getJob: (id) => requireJobs().getJob(id),
    findByIdempotencyKey: (key) => requireJobs().findByIdempotencyKey(key),
    findLatestByIdempotencyKeyPrefix: (prefix) =>
      requireJobs().findLatestByIdempotencyKeyPrefix(prefix),
    stats: () => requireJobs().stats(),
    start: () => requireJobs().start(),
    stop: () => requireJobs().stop(),
  };

  const vaultsHolder: {
    current: ReturnType<typeof createDomainServices>["vaults"] | null;
  } = { current: null };

  // Fail-fast stubs until createVaultSyncController assigns real impl (same as pre-modularization).
  let forceVaultIndexResync: VaultSyncController["forceVaultIndexResync"] = () => {
    throw new Error("forceVaultIndexResync not initialized");
  };
  let resetOnUnhealthyRebuild: VaultSyncController["resetOnUnhealthyRebuild"] =
    async () => {
      throw new Error("resetOnUnhealthyRebuild not initialized");
    };

  const vaultLayoutGuard = createVaultLayoutGuardRunner({
    getContext: () => getContext(),
    onComplete: (vaultId, vaultPath) => {
      forceVaultIndexResync(vaultId, vaultPath, {
        restartWatcher: false,
      });
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
    openSql: () => NodeSqliteExecutor.open(dbPath),
    onUnhealthyRebuildStart: async () => {
      await resetOnUnhealthyRebuild();
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
    return new SqlVaultIndexStore(requireSqlSession());
  }

  function requireSqlSession() {
    const session = indexBoot.getSql();
    if (!session || !indexBoot.isHealthy()) {
      throw new Error("Collector database is not initialized");
    }
    return session;
  }

  const itemEmbeddings = createItemEmbeddingsService({
    getDb: requireSqlSession,
  });

  async function enqueueEmbeddingRefresh(
    vaultId: string,
    inputs: import("@collector/core").ItemEmbeddingRefreshInput[],
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }
    await enqueueRefreshEmbeddings(requireJobs(), { vaultId, inputs });
  }

  async function enqueueItemDerivedRefreshJob(
    vaultId: string,
    vaultPath: string,
    itemId: string,
    contentRevision: number,
    fileMtimeMs: number,
    itemUrl?: string | null,
  ): Promise<void> {
    await enqueueItemDerivedRefreshWithFailureReporting(
      { requireJobs, jobPermanentFailure },
      {
        vaultId,
        vaultPath,
        itemId,
        contentRevision,
        fileMtimeMs,
        ...(itemUrl !== undefined ? { itemUrl } : {}),
      },
    );
  }

  function getContext() {
    return {
      fs,
      index: getIndex(),
      embeddings: itemEmbeddings,
      embeddingRefreshJobs: {
        enqueue: enqueueEmbeddingRefresh,
      },
      itemDerivedRefreshJobs: {
        enqueue: enqueueItemDerivedRefreshJob,
      },
    };
  }

  // Periodic catch-up for missing/stale item embeddings (#742).
  // Defaults: interval 3 min, batchSize 50, scanLimit 200 — see scheduler module.
  const embeddingReconcile = createEmbeddingReconcileScheduler({
    isHealthy: () => indexBoot.isHealthy() && !runtimeClosed,
    resolveActiveVaultId: () =>
      vaultsHolder.current?.getActiveVaultEntry()?.meta.id ?? null,
    getDb: requireSqlSession,
    getModelId: () => itemEmbeddings.engine.modelId,
    enqueueRefresh: enqueueEmbeddingRefresh,
  });

  async function ensureInitialized(): Promise<void> {
    await indexBoot.ensureHealthy();
  }

  const vaultSyncController = createVaultSyncController({
    getContext,
    vaultIndexSyncStatus,
    vaultFsWatcher,
    vaultLayoutGuard,
    requireJobs,
    jobPermanentFailure,
    isRuntimeClosed: () => runtimeClosed,
  });
  forceVaultIndexResync = vaultSyncController.forceVaultIndexResync;
  resetOnUnhealthyRebuild = vaultSyncController.resetOnUnhealthyRebuild;

  phaseBHandlerBindings.vaultIndexSync = createVaultIndexSyncHandler({
    startVaultIndexSync: vaultSyncController.startVaultIndexSync,
  });
  phaseBHandlerBindings.reindexVaultBatch = createReindexVaultBatchHandler({
    getContext,
    onItemsSynced: vaultSyncController.notifyWatchItemsSynced,
    onWatchApplied: (vaultId, vaultPath) => {
      vaultLayoutGuard.schedule(vaultId, vaultPath);
    },
  });

  const domainServices = createDomainServices({
    dataDir,
    ensureInitialized,
    getContext,
    getIndex,
    itemEmbeddings,
    appSettings,
    dashboardSnapshot,
    vaultFsWatcher,
    vaultSync: vaultSyncController,
    vaultPresentationChanged,
    requireJobs,
    jobPermanentFailure,
  });
  vaultsHolder.current = domainServices.vaults;

  const localizeRemoteDisplayAssets = createLocalizeItemRemoteDisplayAssets({
    getContext,
    resolveActiveVault: () => vaults.resolveActiveVault(),
  });

  phaseBHandlerBindings.itemDerivedRefresh = createItemDerivedRefreshHandler({
    getContext,
    localizeRemoteDisplayAssets,
    onVaultPresentationChanged: (payload) =>
      vaultPresentationChanged.notify(payload),
  });

  const { vaults, itemsSearch, tagsFolders, mediaCover } = domainServices;

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
    invalidateThumbnailPathCache: (itemId) =>
      mediaCover.invalidateThumbnailPathCache(itemId),
    onVaultPresentationChanged: (payload) =>
      vaultPresentationChanged.notify(payload),
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

  phaseBHandlerBindings.importFolder = createImportFolderHandler({
    createItem: (input) => itemsSearch.createItem(input),
    attachMediaFiles: (itemId, files) =>
      mediaCover.attachMediaFiles(itemId, files),
    updateItemSource: (itemId, raw) =>
      itemsSearch.updateItemSource(itemId, raw),
    findItemIdByUrl: (vaultId, url) => getIndex().findItemIdByUrl(vaultId, url),
    assertActiveVault: async (vaultId) => {
      await requireActiveVaultPath(vaultId);
    },
  });

  const dropImport = createDropImportRuntime({
    dataDir,
    resolveActiveVault: () => vaults.resolveActiveVault(),
    requireJobs,
  });

  const waitDerived = createWaitDerivedRuntime({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    requireJobs,
  });

  const credentials = createCredentialsService({
    backend: createOsKeychainBackend(),
  });

  const resolveActiveVaultId = async () => {
    const { vault } = await vaults.resolveActiveVault();
    return vault.id;
  };

  const {
    syncPlugins,
    telegramSync,
    syncPluginWake: syncPluginWakeInner,
  } = createSyncPluginRuntime({
    fs,
    dataDir,
    credentials,
    itemsSearch,
    mediaCover,
    tagsFolders,
    resolveActiveVaultId,
    requireJobs,
    jobPermanentFailure,
    wakePolicies: options.wakePolicies,
  });

  const instagramExtractor = createInstagramExtractorPlugin({
    getItemById: (itemId) => itemsSearch.getItemById(itemId),
    updateItem: (itemId, input) => itemsSearch.updateItem(itemId, input),
    attachMediaFiles: (itemId, files) =>
      mediaCover.attachMediaFiles(itemId, files),
  });

  const extract = createExtractPluginRegistry({
    getItemById: (itemId) => itemsSearch.getItemById(itemId),
    createCatalog: () => [instagramExtractor],
  });

  phaseBHandlerBindings.itemExtractAuto = createItemExtractAutoHandler({
    getItemById: (itemId) => itemsSearch.getItemById(itemId),
    updateItem: (itemId, input) => itemsSearch.updateItem(itemId, input),
    discoverExtractCandidates: (itemId) =>
      extract.discoverExtractCandidates(itemId),
    extractItemCandidate: (itemId, candidate) =>
      extract.extractItemCandidate(itemId, candidate),
    jobPermanentFailure,
  });

  // Boot order: open()/start() may run before ensureActiveVault. Wake again on
  // vault-ready (same signal as sync plugins) so reconcile does not wait a full interval.
  const syncPluginWake: typeof syncPluginWakeInner = {
    register: (pluginId, policy) =>
      syncPluginWakeInner.register(pluginId, policy),
    dispose: () => syncPluginWakeInner.dispose(),
    async notifyVaultReady() {
      await syncPluginWakeInner.notifyVaultReady();
      embeddingReconcile.wake();
    },
  };

  const derivedCatchUpRefresher = createDerivedCatchUpStatusRefresher({
    store: derivedCatchUpStatus,
    // Fail closed when the queue is already torn down (#817 / #811).
    stats: async () => {
      if (!jobsQueue) {
        return { ...emptyStatusCounts(), byType: {} };
      }
      return jobsQueue.stats();
    },
    getActiveVaultId: () =>
      vaultsHolder.current?.getActiveVaultEntry()?.meta.id ?? null,
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
          onActivity: () => {
            void derivedCatchUpRefresher.refresh();
          },
        });
        jobsQueue.start();
        await derivedCatchUpRefresher.refresh(true);
      }
      embeddingReconcile.start();
    },
    ensureInitialized,
    isHealthy: () => indexBoot.isHealthy(),
    async close() {
      runtimeClosed = true;
      derivedCatchUpRefresher.dispose();
      embeddingReconcile.dispose();
      vaultLayoutGuard.dispose();
      syncPluginWake.dispose();
      await Promise.allSettled([...vaultSyncController.vaultSyncPromises.values()]);
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
    derivedCatchUpStatus,
    vaultPresentationChanged,
    startVaultFilesystemWatcher: (vaultId, vaultPath) =>
      vaultFsWatcher.start(vaultId, vaultPath),
    stopVaultFilesystemWatcher: () => vaultFsWatcher.stop(),
    isVaultFilesystemWatcherActive: () => vaultFsWatcher.isWatching(),
    itemsSearch,
    tagsFolders,
    mediaCover,
    dropImport,
    waitDerived,
    vaults,
    appSettings,
    credentials,
    syncPlugins,
    extract,
    telegramSync,
    syncPluginWake,
    dashboardSnapshot,
    jobs,
    jobPermanentFailure,
  };
}
