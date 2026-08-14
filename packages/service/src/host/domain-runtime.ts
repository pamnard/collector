/**
 * Sole domain runtime for vault-index sync / watcher / SQLite (#328).
 *
 * Service host (desktop wire, CLI, MCP) composes this once. UI is a thin
 * client over the host — do not re-create sync/watcher orchestration in the UI.
 */

import { mkdir } from "node:fs/promises";
import {
  SqlVaultIndexStore,
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
  migrateLegacyUnifiedProfileLayout,
  resolveItemThumbnailPathsBatch,
  syncVaultIndexFromFilesystem,
  type IndexSyncProgress,
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
import { createSyncPluginRegistry } from "../sync-plugin-registry.js";
import {
  createSyncPluginWakeController,
  type SyncPluginWakePolicy,
  type SyncPluginWakeController,
} from "../sync-plugin-wake.js";
import {
  DEFAULT_TELEGRAM_SYNC_INTERVAL_MS,
  TELEGRAM_PLUGIN_ID,
  createTelegramSyncPlugin,
  createTelegramSyncService,
  loadTelegramPluginConfig,
  markTelegramLastSyncAt,
} from "../plugins/telegram/index.js";
import type { TelegramSyncPort, SyncPluginsPort } from "@collector/api";
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
  createJobQueue,
  testNoopHandler,
  type JobQueue,
} from "../jobs/job-queue.js";

const SYNC_STATUS_THROTTLE_MS = 200;

function createThrottledPublisher(
  fn: () => void,
  intervalMs: number,
): { schedule: () => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    fn();
  };

  return {
    schedule() {
      const elapsed = Date.now() - lastRun;
      if (elapsed >= intervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, intervalMs - elapsed);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

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
  const vaultSyncListeners = new Map<
    string,
    Set<{
      onBatch?: (p: IndexSyncProgress) => void;
      onComplete?: () => void;
    }>
  >();
  const vaultIndexSyncStatus = createVaultIndexSyncStatusStore();
  const vaultPresentationChanged = createVaultPresentationChangedStore();
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
    onItemsSynced: (vaultId) => {
      // Same subscriber class as full sync: in-process listeners + status channel (#567).
      // Split running→done across turns so React subscribers observe the transition.
      const previous = vaultIndexSyncStatus.get();
      vaultIndexSyncStatus.set({
        vaultId,
        status: "running",
        progress: previous.progress,
        metadataReady: true,
        ftsReady: previous.ftsReady || previous.status === "done",
      });
      emitComplete(vaultId);
      setTimeout(() => {
        vaultIndexSyncStatus.set({
          vaultId,
          status: "done",
          progress: previous.progress,
          metadataReady: true,
          ftsReady: true,
        });
      }, 0);
    },
    forceVaultIndexResync: (vaultId, vaultPath) => {
      forceVaultIndexResync(vaultId, vaultPath);
    },
    onWatchApplied: (vaultId, vaultPath) => {
      vaultLayoutGuard.schedule(vaultId, vaultPath);
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
    return { fs, index: getIndex(), embeddings: itemEmbeddings };
  }

  async function ensureInitialized(): Promise<void> {
    await indexBoot.ensureHealthy();
  }

  function addVaultSyncListener(
    vaultId: string,
    listener: {
      onBatch?: (p: IndexSyncProgress) => void;
      onComplete?: () => void;
    },
  ): () => void {
    let set = vaultSyncListeners.get(vaultId);
    if (!set) {
      set = new Set();
      vaultSyncListeners.set(vaultId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        vaultSyncListeners.delete(vaultId);
      }
    };
  }

  function emitComplete(vaultId: string): void {
    const set = vaultSyncListeners.get(vaultId);
    if (!set) return;
    for (const listener of set) {
      listener.onComplete?.();
    }
  }

  async function startVaultIndexSync(
    vaultId: string,
    vaultPath: string,
  ): Promise<void> {
    if (syncedVaultIds.has(vaultId)) {
      if (
        !runtimeClosed &&
        !watcherDisabledVaultIds.has(vaultId) &&
        !vaultFsWatcher.isWatching()
      ) {
        void vaultFsWatcher.start(vaultId, vaultPath).catch((error: unknown) => {
          console.error("[collector] start vault filesystem watcher:", error);
        });
      }
      return;
    }
    const inflight = vaultSyncPromises.get(vaultId);
    if (inflight) {
      return inflight;
    }

    let metadataReady = true;
    let ftsReady = false;

    vaultIndexSyncStatus.set({
      vaultId,
      status: "running",
      progress: {
        phase: "metadata",
        processed: 0,
        total: 0,
        skipped: 0,
        patched: 0,
        indexed: 0,
        contentIndexed: 0,
        removed: 0,
      },
      metadataReady,
      ftsReady,
    });

    let latestProgress: IndexSyncProgress = {
      phase: "metadata",
      processed: 0,
      total: 0,
      skipped: 0,
      patched: 0,
      indexed: 0,
      contentIndexed: 0,
      removed: 0,
    };

    const publishRunningStatus = createThrottledPublisher(() => {
      vaultIndexSyncStatus.set({
        vaultId,
        status: "running",
        progress: latestProgress,
        metadataReady,
        ftsReady,
      });
    }, SYNC_STATUS_THROTTLE_MS);

    const noteProgress = (progress: IndexSyncProgress) => {
      latestProgress = progress;
      if (
        metadataReady &&
        progress.phase === "metadata" &&
        progress.processed < progress.total
      ) {
        metadataReady = false;
        publishRunningStatus.flush();
        return;
      }
      publishRunningStatus.schedule();
    };

    const promise = (async () => {
      try {
        const report = await syncVaultIndexFromFilesystem(
          getContext(),
          vaultPath,
          {
            onProgress: (progress) => {
              noteProgress(progress);
            },
            onBatch: (progress) => {
              noteProgress(progress);
              const set = vaultSyncListeners.get(vaultId);
              if (set) {
                for (const listener of set) {
                  listener.onBatch?.(progress);
                }
              }
            },
            onMetadataComplete: (progress) => {
              latestProgress = progress;
              metadataReady = true;
              publishRunningStatus.flush();
            },
          },
        );
        if (report.vaultId !== vaultId) {
          throw new Error(
            `Vault id mismatch during index sync: expected ${vaultId}, got ${report.vaultId}`,
          );
        }
        syncedVaultIds.add(vaultId);
        metadataReady = true;
        ftsReady = true;
        const finalProgress: IndexSyncProgress = {
          phase: "content",
          processed: report.indexed + report.patched + report.skipped,
          total: report.indexed + report.patched + report.skipped,
          skipped: report.skipped,
          patched: report.patched,
          indexed: report.indexed,
          contentIndexed: report.contentIndexed,
          removed: report.removed,
        };
        publishRunningStatus.cancel();
        vaultIndexSyncStatus.set({
          vaultId,
          status: "done",
          progress: finalProgress,
          metadataReady,
          ftsReady,
        });
        emitComplete(vaultId);
        if (
          !runtimeClosed &&
          !watcherDisabledVaultIds.has(vaultId)
        ) {
          void vaultFsWatcher.start(vaultId, vaultPath).catch((error: unknown) => {
            console.error("[collector] start vault filesystem watcher:", error);
          });
        }
      } catch (error) {
        publishRunningStatus.cancel();
        vaultIndexSyncStatus.set({
          vaultId,
          status: "idle",
          progress: null,
          metadataReady: false,
          ftsReady: false,
        });
        throw error;
      }
    })().finally(() => {
      vaultSyncPromises.delete(vaultId);
    });
    vaultSyncPromises.set(vaultId, promise);
    return promise;
  }

  function kickoffVaultIndexSync(vaultId: string, vaultPath: string): void {
    vaultLayoutGuard.schedule(vaultId, vaultPath);
    void startVaultIndexSync(vaultId, vaultPath).catch((error: unknown) => {
      console.error("[collector] index sync failed:", error);
    });
  }

  forceVaultIndexResync = (
    vaultId: string,
    vaultPath: string,
    options: { restartWatcher?: boolean } = {},
  ) => {
    if (options.restartWatcher === false) {
      watcherDisabledVaultIds.add(vaultId);
    }
    syncedVaultIds.delete(vaultId);
    kickoffVaultIndexSync(vaultId, vaultPath);
  };

  function isVaultFtsReady(vaultId: string): boolean {
    return syncedVaultIds.has(vaultId);
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
    startVaultIndexSync,
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
    generateCoverFromMedia,
    resolveThumbnailPathsBatch: (vaultPath, items) =>
      resolveItemThumbnailPathsBatch(getContext().fs, vaultPath, items),
    onVaultPresentationChanged: (vaultId) =>
      vaultPresentationChanged.notify(vaultId),
  });

  const dropImport = createDropImportService({
    createItem: (input) => itemsSearch.createItem(input),
    attachMediaFiles: (itemId, files) =>
      mediaCover.attachMediaFiles(itemId, files),
    updateItemSource: (itemId, raw) =>
      itemsSearch.updateItemSource(itemId, raw),
  });

  const credentials = createCredentialsService({
    backend: createOsKeychainBackend(),
  });

  const resolveActiveVaultId = async () => {
    const { vault } = await vaults.resolveActiveVault();
    return vault.id;
  };

  const telegramPlugin = createTelegramSyncPlugin({
    credentials,
    fs,
    dataDir,
    resolveActiveVaultId,
    listFolderTree: () => tagsFolders.listFolderTree(),
  });

  const registry = createSyncPluginRegistry({
    fs,
    dataDir,
    resolveActiveVaultId,
    createItem: (input) => itemsSearch.createItem(input),
    attachMediaFiles: (itemId, files) =>
      mediaCover.attachMediaFiles(itemId, files),
    createCatalog: () => [telegramPlugin],
  });

  const syncPlugins: SyncPluginsPort = {
    async syncNow(pluginId) {
      const result = await registry.syncNow(pluginId);
      if (pluginId === TELEGRAM_PLUGIN_ID) {
        await markTelegramLastSyncAt({
          fs,
          dataDir,
          resolveActiveVaultId,
        });
      }
      return result;
    },
  };

  const telegramSyncBase = createTelegramSyncService({
    fs,
    dataDir,
    resolveActiveVaultId,
    listFolderTree: () => tagsFolders.listFolderTree(),
  });

  const syncPluginWakeInner = createSyncPluginWakeController({
    syncNow: (pluginId) => syncPlugins.syncNow(pluginId),
  });

  const telegramWakeOverridden =
    options.wakePolicies?.[TELEGRAM_PLUGIN_ID] !== undefined;

  const armTelegramWake = (
    enabled: boolean,
    syncIntervalMs = DEFAULT_TELEGRAM_SYNC_INTERVAL_MS,
  ): void => {
    if (telegramWakeOverridden) {
      return;
    }
    syncPluginWakeInner.register(
      TELEGRAM_PLUGIN_ID,
      enabled
        ? { onVaultReady: true, intervalMs: syncIntervalMs }
        : { onVaultReady: false },
    );
  };

  const refreshTelegramWakeFromConfig = async (): Promise<void> => {
    if (telegramWakeOverridden) {
      return;
    }
    const vaultId = await resolveActiveVaultId();
    const config = await loadTelegramPluginConfig(fs, dataDir, vaultId);
    armTelegramWake(config.enabled, config.sync_interval_ms);
  };

  for (const [pluginId, policy] of Object.entries(options.wakePolicies ?? {})) {
    if (pluginId === TELEGRAM_PLUGIN_ID) {
      continue;
    }
    syncPluginWakeInner.register(pluginId, policy);
  }
  if (telegramWakeOverridden) {
    const override = options.wakePolicies?.[TELEGRAM_PLUGIN_ID];
    if (!override) {
      throw new Error("telegram wake override missing after guard");
    }
    syncPluginWakeInner.register(TELEGRAM_PLUGIN_ID, override);
  } else {
    armTelegramWake(false);
  }

  const syncPluginWake: SyncPluginWakeController = {
    register: (pluginId, policy) =>
      syncPluginWakeInner.register(pluginId, policy),
    dispose: () => syncPluginWakeInner.dispose(),
    async notifyVaultReady() {
      await refreshTelegramWakeFromConfig();
      await syncPluginWakeInner.notifyVaultReady();
    },
  };

  const telegramSync: TelegramSyncPort = {
    getTelegramSyncSettings: () => telegramSyncBase.getTelegramSyncSettings(),
    validateTelegramBotToken: (input) =>
      telegramSyncBase.validateTelegramBotToken(input),
    async updateTelegramSyncSettings(patch) {
      const settings =
        await telegramSyncBase.updateTelegramSyncSettings(patch);
      armTelegramWake(settings.enabled, settings.sync_interval_ms);
      return settings;
    },
  };

  return {
    dataDir,
    async open() {
      await indexBoot.open();
      if (!jobsQueue) {
        jobsQueue = await createJobQueue({
          dbPath: jobsDbPath,
          handlers: { __test_noop: testNoopHandler },
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
  };
}
