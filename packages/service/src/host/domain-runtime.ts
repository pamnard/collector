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
import { NodeSqliteExecutor } from "./node-sql.js";

export interface ServiceDomainRuntime {
  dataDir: string;
  open: () => Promise<void>;
  ensureInitialized: () => Promise<void>;
  isHealthy: () => boolean;
  close: () => Promise<void>;
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

  const vaultsHolder: {
    current: ReturnType<typeof createVaultsService> | null;
  } = { current: null };

  const indexBoot = createCollectorIndexBoot({
    prepareEnvironment: async () => {
      await mkdir(dataDir, { recursive: true });
    },
    openSql: async () => NodeSqliteExecutor.open(dbPath),
    onUnhealthyRebuildStart: async () => {
      syncedVaultIds.clear();
      vaultSyncPromises.clear();
      vaultSyncListeners.clear();
      vaultsHolder.current?.clearActiveVault();
      await dashboardSnapshot.clearDashboardSnapshot();
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
      return;
    }
    const inflight = vaultSyncPromises.get(vaultId);
    if (inflight) {
      return inflight;
    }
    const promise = (async () => {
      await syncVaultIndexFromFilesystem(getContext(), vaultPath);
      syncedVaultIds.add(vaultId);
      emitComplete(vaultId);
    })().finally(() => {
      vaultSyncPromises.delete(vaultId);
    });
    vaultSyncPromises.set(vaultId, promise);
    return promise;
  }

  function kickoffVaultIndexSync(vaultId: string, vaultPath: string): void {
    void startVaultIndexSync(vaultId, vaultPath);
  }

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
    stopVaultFilesystemWatcher: async () => {},
    enableVaultWatcher: () => {},
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
      const sql = indexBoot.getSql();
      if (sql) {
        await sql.close();
      }
    },
    itemsSearch,
    tagsFolders,
    mediaCover,
    vaults,
    appSettings,
    dashboardSnapshot,
  };
}
