/**
 * Out-of-band Node domain runtime for service host IPC (#155+).
 * Not used by the Tauri in-process app path.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  SqlVaultIndexStore,
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
  syncVaultIndexFromFilesystem,
  type IndexSyncProgress,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { createAppSettingsService } from "../app-settings.js";
import { createCollectorIndexBoot } from "../index-boot.js";
import { createDashboardSnapshotService } from "../dashboard-snapshot.js";
import { createItemsSearchService } from "../items-search.js";
import { createMediaCoverService } from "../media-cover.js";
import { createTagsFoldersService } from "../tags-folders.js";
import { createVaultsService } from "../vaults.js";
import {
  createVaultIndexSyncStatusStore,
  type VaultIndexSyncStatusStore,
} from "../sync-status.js";
import { NodeSqliteExecutor } from "./node-sql.js";
import { createNodeVaultFilesystemWatcher } from "./vault-fs-watcher.js";

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
  startVaultFilesystemWatcher: (
    vaultId: string,
    vaultPath: string,
  ) => Promise<void>;
  stopVaultFilesystemWatcher: () => Promise<void>;
  isVaultFilesystemWatcherActive: () => boolean;
  itemsSearch: ReturnType<typeof createItemsSearchService>;
  tagsFolders: ReturnType<typeof createTagsFoldersService>;
  mediaCover: ReturnType<typeof createMediaCoverService>;
  vaults: ReturnType<typeof createVaultsService>;
  appSettings: ReturnType<typeof createAppSettingsService>;
  dashboardSnapshot: ReturnType<typeof createDashboardSnapshotService>;
}

export function createServiceDomainRuntime(
  dataDir: string,
): ServiceDomainRuntime {
  const fs = new NodeFileSystemAdapter();
  const configDir = join(dataDir, "config");
  const dbPath = join(dataDir, "collector.db");

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
  const watcherDisabledVaultIds = new Set<string>();
  let runtimeClosed = false;

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

  const vaultFsWatcher = createNodeVaultFilesystemWatcher({
    getContext: () => getContext(),
    getActiveVaultId: () =>
      vaultsHolder.current?.getActiveVaultEntry()?.meta.id ?? null,
    onItemsSynced: () => {
      // Targeted sync already updated the index; status channel stays as-is.
    },
    forceVaultIndexResync: (vaultId, vaultPath) => {
      forceVaultIndexResync(vaultId, vaultPath);
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
    },
    openSql: async () => NodeSqliteExecutor.open(dbPath),
    onUnhealthyRebuildStart: async () => {
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

  function getContext() {
    return { fs, index: getIndex() };
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
  });

  const tagsFolders = createTagsFoldersService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext,
    kickoffVaultIndexSync,
    addVaultSyncListener,
  });

  const mediaCover = createMediaCoverService({
    resolveActiveVault: () => vaults.resolveActiveVault(),
    getContext,
    generateCoverFromMedia: async () => null,
    resolveThumbnailPathsBatch: async (_vaultPath, items) =>
      items.map((item) => ({ id: item.id, path: null })),
  });

  return {
    dataDir,
    open: () => indexBoot.open(),
    ensureInitialized,
    isHealthy: () => indexBoot.isHealthy(),
    async close() {
      runtimeClosed = true;
      await vaultFsWatcher.stop();
      const sql = indexBoot.getSql();
      if (sql) {
        await sql.close();
      }
    },
    vaultIndexSyncStatus,
    startVaultFilesystemWatcher: (vaultId, vaultPath) =>
      vaultFsWatcher.start(vaultId, vaultPath),
    stopVaultFilesystemWatcher: () => vaultFsWatcher.stop(),
    isVaultFilesystemWatcherActive: () => vaultFsWatcher.isWatching(),
    itemsSearch,
    tagsFolders,
    mediaCover,
    vaults,
    appSettings,
    dashboardSnapshot,
  };
}
