import { appDataDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { ItemFile, VaultMeta } from "@collector/shared";
import type { MediaFileMeta } from "@collector/shared";
import {
  createCollectorIndexBoot,
  createItemsSearchService,
  createTagsFoldersService,
  createMediaCoverService,
  createVaultIndexSyncStatusStore,
  createVaultsService,
  type VaultIndexSyncStatus,
  type VaultsService,
} from "@collector/service";
import type {
  DashboardIndexPage,
  DashboardItemIdsResult,
} from "@collector/service";
import { DASHBOARD_PREFETCH_SIZE } from "@collector/service";
import { removeItemIdFromDashboardQueryCache } from "./dashboard-query-cache";
import {
  SqlVaultIndexStore,
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
  syncVaultIndexFromFilesystem,
} from "@collector/core";
import type {
  FolderTreeNode,
  IndexSyncProgress,
  MediaWithPath,
  TagWithCount,
} from "@collector/core";
import type { Tag } from "@collector/shared";
import type { CreateItemInput, UpdateItemInput } from "../types/item";
import type { NavFilter } from "../types/ui";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { TauriSqlAdapter } from "../adapters/tauri-sql";
import {
  ensureAppSettings,
  updateAppSettings,
} from "./app-settings-service";
import { clearDashboardSnapshot } from "./dashboard-snapshot-service";
import { generateCoverFromMedia } from "./thumbnail-service";
import { getLegacyIndexDatabasePaths } from "./index-db-path";
import { reportServiceError } from "./runtime-error";
import {
  configureVaultFilesystemWatcher,
  startVaultFilesystemWatcher,
  stopVaultFilesystemWatcher,
} from "./vault-fs-watcher-service";
import { isDevMock } from "../dev/is-dev-mock";
import * as devMockCollector from "../dev/mock-collector";

export type { VaultIndexSyncStatus };

let dataDir = "";
const syncedVaultIds = new Set<string>();
const vaultSyncPromises = new Map<string, Promise<void>>();
/** Watcher start/runtime failure: fall back to reconcile once, do not loop start→fail→resync. */
const watcherDisabledVaultIds = new Set<string>();
const fs = new TauriFileSystemAdapter();

const vaultsHolder: { current: VaultsService | null } = { current: null };

configureVaultFilesystemWatcher({
  getContext,
  getActiveVaultId: () => vaultsHolder.current?.getActiveVaultEntry()?.meta.id ?? null,
  onItemsSynced: (vaultId) => {
    emitVaultSyncEvent(vaultId, "complete");
  },
  forceVaultIndexResync: (vaultId, vaultPath) => {
    forceVaultIndexResync(vaultId, vaultPath, { restartWatcher: false });
  },
});

type VaultSyncListener = {
  onProgress?: (progress: IndexSyncProgress) => void;
  onBatch?: (progress: IndexSyncProgress) => void;
  onComplete?: () => void;
};

const vaultSyncListeners = new Map<string, Set<VaultSyncListener>>();
const vaultIndexSyncStatusStore = createVaultIndexSyncStatusStore();

function setVaultIndexSyncStatus(next: VaultIndexSyncStatus): void {
  vaultIndexSyncStatusStore.set(next);
}

const SYNC_STATUS_THROTTLE_MS = 200;
const SYNC_REPUBLISH_THROTTLE_MS = 500;

/** Schedule `fn` at most once per `intervalMs`; `flush` runs immediately and cancels pending. */
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

function emitVaultSyncEvent(
  vaultId: string,
  event: "progress" | "batch" | "complete",
  progress?: IndexSyncProgress,
): void {
  const listeners = vaultSyncListeners.get(vaultId);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    if (event === "progress" && progress) {
      listener.onProgress?.(progress);
    }
    if (event === "batch" && progress) {
      listener.onBatch?.(progress);
    }
    if (event === "complete") {
      listener.onComplete?.();
    }
  }
}

function addVaultSyncListener(
  vaultId: string,
  listener: VaultSyncListener,
): () => void {
  let listeners = vaultSyncListeners.get(vaultId);
  if (!listeners) {
    listeners = new Set();
    vaultSyncListeners.set(vaultId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) {
      vaultSyncListeners.delete(vaultId);
    }
  };
}

/** Subscribe to global vault index sync progress (banner). */
export function subscribeVaultIndexSyncStatus(
  onUpdate: (status: VaultIndexSyncStatus) => void,
): () => void {
  return vaultIndexSyncStatusStore.subscribe(onUpdate);
}

export function getVaultIndexSyncStatus(): VaultIndexSyncStatus {
  return vaultIndexSyncStatusStore.get();
}

function isVaultFtsReady(vaultId: string): boolean {
  if (syncedVaultIds.has(vaultId)) {
    return true;
  }
  const status = getVaultIndexSyncStatus();
  if (status.vaultId !== vaultId) {
    return true;
  }
  return status.ftsReady;
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

async function removeLegacyIndexDatabaseFiles(): Promise<void> {
  for (const dbPath of await getLegacyIndexDatabasePaths()) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = `${dbPath}${suffix}`;
      if (await fs.exists(path)) {
        await fs.remove(path);
      }
    }
  }
}

const indexBoot = createCollectorIndexBoot<TauriSqlAdapter>({
  prepareEnvironment: async () => {
    dataDir = await join(await appDataDir(), "collector");
    await fs.mkdir(dataDir);
    await removeLegacyIndexDatabaseFiles();
  },
  openSql: () => TauriSqlAdapter.open(),
  onUnhealthyRebuildStart: async () => {
    setVaultIndexSyncStatus({
      vaultId: null,
      status: "rebuilding",
      progress: null,
      metadataReady: false,
      ftsReady: false,
    });
    await clearDashboardSnapshot();
    syncedVaultIds.clear();
    vaultSyncPromises.clear();
    watcherDisabledVaultIds.clear();
    vaultsHolder.current?.clearActiveVault();
    await stopVaultFilesystemWatcher();
  },
  onUnhealthyRebuildFinally: () => {
    if (vaultIndexSyncStatusStore.get().status === "rebuilding") {
      setVaultIndexSyncStatus({
        vaultId: null,
        status: "idle",
        progress: null,
        metadataReady: false,
        ftsReady: false,
      });
    }
  },
});

/**
 * Open SQLite and run migrations so the app shell can mount.
 * Does not wait for health probes / schema rebuild — use
 * {@link ensureCollectorDatabaseHealthy} for that.
 */
export async function openCollectorDatabase(): Promise<void> {
  if (isDevMock()) {
    return devMockCollector.warmupCollector();
  }
  await indexBoot.open();
}

/**
 * Finish index health checks (and schema rebuild if needed).
 * All UI SQL queries go through {@link ensureInitialized}, which awaits this.
 */
export async function ensureCollectorDatabaseHealthy(): Promise<void> {
  if (isDevMock()) {
    return;
  }
  await indexBoot.ensureHealthy();
}

async function ensureInitialized(): Promise<void> {
  if (isDevMock()) {
    await devMockCollector.warmupCollector();
    return;
  }
  await indexBoot.ensureHealthy();
}

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

function startVaultIndexSync(vaultId: string, vaultPath: string): Promise<void> {
  if (syncedVaultIds.has(vaultId)) {
    return Promise.resolve();
  }

  const inflight = vaultSyncPromises.get(vaultId);
  if (inflight) {
    return inflight;
  }

  // Optimistic: do not claim metadata is unavailable until reconcile confirms work.
  // Banner gate is `running && !metadataReady` — start ready so no-op/fast-path
  // never flashes a false indexing state.
  let metadataReady = true;
  let ftsReady = false;

  setVaultIndexSyncStatus({
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
    setVaultIndexSyncStatus({
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
      const report = await syncVaultIndexFromFilesystem(getContext(), vaultPath, {
        onProgress: (progress) => {
          noteProgress(progress);
          emitVaultSyncEvent(vaultId, "progress", progress);
        },
        onBatch: (progress) => {
          noteProgress(progress);
          emitVaultSyncEvent(vaultId, "batch", progress);
        },
        onMetadataComplete: (progress) => {
          latestProgress = progress;
          metadataReady = true;
          publishRunningStatus.flush();
          emitVaultSyncEvent(vaultId, "batch", progress);
        },
      });
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
      setVaultIndexSyncStatus({
        vaultId,
        status: "done",
        progress: finalProgress,
        metadataReady,
        ftsReady,
      });
      emitVaultSyncEvent(vaultId, "complete");
      if (!watcherDisabledVaultIds.has(vaultId)) {
        void startVaultFilesystemWatcher(vaultId, vaultPath).catch(
          (error: unknown) => {
            reportServiceError("start vault filesystem watcher", error);
          },
        );
      }
    } catch (error) {
      publishRunningStatus.cancel();
      setVaultIndexSyncStatus({
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
    reportServiceError("index sync", error);
  });
}

function forceVaultIndexResync(
  vaultId: string,
  vaultPath: string,
  options: { restartWatcher?: boolean } = {},
): void {
  if (options.restartWatcher === false) {
    watcherDisabledVaultIds.add(vaultId);
  }
  syncedVaultIds.delete(vaultId);
  kickoffVaultIndexSync(vaultId, vaultPath);
}

const vaults = createVaultsService({
  ensureInitialized,
  getDataDir: () => dataDir,
  getContext,
  ensureAppSettings,
  updateAppSettings,
  clearDashboardSnapshot,
  stopVaultFilesystemWatcher,
  enableVaultWatcher: (vaultId) => {
    watcherDisabledVaultIds.delete(vaultId);
  },
});
vaultsHolder.current = vaults;

async function resolveActiveVault(): Promise<{ vault: VaultMeta; path: string }> {
  return vaults.resolveActiveVault();
}

export async function ensureActiveVault(): Promise<{
  vault: VaultMeta;
  path: string;
}> {
  if (isDevMock()) {
    return devMockCollector.ensureActiveVault();
  }
  return vaults.ensureActiveVault();
}

const itemsSearch = createItemsSearchService({
  resolveActiveVault,
  getContext,
  getIndex,
  kickoffVaultIndexSync,
  startVaultIndexSync,
  buildSearchFtsQuery,
  addVaultSyncListener,
  onItemDeleted: removeItemIdFromDashboardQueryCache,
  syncRepublishThrottleMs: SYNC_REPUBLISH_THROTTLE_MS,
});

const tagsFolders = createTagsFoldersService({
  resolveActiveVault,
  getContext,
  kickoffVaultIndexSync,
  addVaultSyncListener,
  syncRepublishThrottleMs: SYNC_REPUBLISH_THROTTLE_MS,
});

const mediaCover = createMediaCoverService({
  resolveActiveVault,
  getContext,
  generateCoverFromMedia,
  resolveThumbnailPathsBatch: async (vaultPath, items) =>
    invoke<Array<{ id: string; path: string | null }>>(
      "resolve_item_thumbnail_paths",
      {
        vaultPath,
        items,
      },
    ),
});

export { DASHBOARD_PREFETCH_SIZE };
export type { DashboardIndexPage, DashboardItemIdsResult };

export async function listItems(): Promise<ItemFile[]> {
  return itemsSearch.listItems();
}

export async function searchItems(
  query: string,
  filter: NavFilter,
): Promise<ItemFile[]> {
  return itemsSearch.searchItems(query, filter);
}

export async function fetchDashboardIndexPage(
  filter: NavFilter,
  query = "",
  page: { limit: number; offset: number },
): Promise<DashboardIndexPage> {
  if (isDevMock()) {
    return devMockCollector.fetchDashboardIndexPage(filter, query, page);
  }
  return itemsSearch.fetchDashboardIndexPage(filter, query, page);
}

export async function listDashboardItemIds(
  filter: NavFilter,
  query = "",
): Promise<DashboardItemIdsResult> {
  if (isDevMock()) {
    const page = await fetchDashboardIndexPage(filter, query, {
      limit: DASHBOARD_PREFETCH_SIZE,
      offset: 0,
    });
    return {
      itemIds: page.itemIds,
      totalCount: page.totalCount,
      indexSync: Promise.resolve(),
    };
  }
  return itemsSearch.listDashboardItemIds(filter, query);
}

export function subscribeDashboardLoad(
  filter: NavFilter,
  query: string,
  handlers: {
    onIndexPage: (page: DashboardIndexPage) => void;
    getLoadedIdCount?: () => number;
    onLoadComplete?: () => void;
    onError?: (scope: string, error: unknown) => void;
  },
  signal?: AbortSignal,
): void {
  if (isDevMock()) {
    void devMockCollector
      .fetchDashboardIndexPage(filter, query, {
        limit: DASHBOARD_PREFETCH_SIZE,
        offset: 0,
      })
      .then((page) => {
        handlers.onIndexPage(page);
        handlers.onLoadComplete?.();
      })
      .catch((error: unknown) => {
        handlers.onError?.("dashboard load", error);
      });
    return;
  }
  itemsSearch.subscribeDashboardLoad(filter, query, handlers, signal);
}

export async function streamDashboardItems(
  itemIds: string[],
  offset: number,
  limit: number,
  onItem: (item: ItemFile) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (isDevMock()) {
    await devMockCollector.streamDashboardItems(
      itemIds,
      offset,
      limit,
      onItem,
      signal,
    );
    return;
  }
  return itemsSearch.streamDashboardItems(itemIds, offset, limit, onItem, signal);
}

export async function loadDashboardItems(
  itemIds: string[],
  offset: number,
  limit = DASHBOARD_PREFETCH_SIZE,
): Promise<ItemFile[]> {
  if (isDevMock()) {
    return devMockCollector.loadDashboardItems(itemIds, offset, limit);
  }
  return itemsSearch.loadDashboardItems(itemIds, offset, limit);
}

export async function getItemById(
  itemId: string,
): Promise<{ item: ItemFile; content: string | null }> {
  if (isDevMock()) {
    return devMockCollector.getItemById(itemId);
  }
  return itemsSearch.getItemById(itemId);
}

export async function getItemSource(itemId: string): Promise<string> {
  if (isDevMock()) {
    return devMockCollector.getItemSource(itemId);
  }
  return itemsSearch.getItemSource(itemId);
}

export async function updateItemSource(
  itemId: string,
  rawMarkdown: string,
): Promise<ItemFile> {
  if (isDevMock()) {
    return devMockCollector.updateItemSource(itemId, rawMarkdown);
  }
  return itemsSearch.updateItemSource(itemId, rawMarkdown);
}

export async function createItem(input: CreateItemInput): Promise<ItemFile> {
  return itemsSearch.createItem(input);
}

export async function updateItem(
  itemId: string,
  input: UpdateItemInput,
): Promise<ItemFile> {
  if (isDevMock()) {
    return devMockCollector.updateItem(itemId, input);
  }
  return itemsSearch.updateItem(itemId, input);
}

export async function deleteItem(itemId: string): Promise<void> {
  return itemsSearch.deleteItem(itemId);
}

export async function getDataDirectory(): Promise<string> {
  await ensureInitialized();
  return dataDir;
}

export async function listVaults(): Promise<VaultMeta[]> {
  return vaults.listVaults();
}

export async function getActiveVaultMeta(): Promise<VaultMeta> {
  return vaults.getActiveVaultMeta();
}

export async function switchVault(vaultId: string): Promise<VaultMeta> {
  return vaults.switchVault(vaultId);
}

export async function setDefaultVault(vaultId: string): Promise<void> {
  return vaults.setDefaultVault(vaultId);
}

export function subscribeTags(
  onUpdate: (tags: TagWithCount[]) => void,
  handlers?: {
    onError?: (scope: string, error: unknown) => void;
  },
  signal?: AbortSignal,
): void {
  if (isDevMock()) {
    void devMockCollector
      .listTags()
      .then(onUpdate)
      .catch((error: unknown) => {
        handlers?.onError?.("tags", error);
        onUpdate([]);
      });
    return;
  }
  tagsFolders.subscribeTags(onUpdate, handlers, signal);
}

export async function listTags(): Promise<TagWithCount[]> {
  if (isDevMock()) {
    return devMockCollector.listTags();
  }
  return tagsFolders.listTags();
}

export async function createTag(input: {
  name: string;
  color?: string | null;
}): Promise<Tag> {
  return tagsFolders.createTag(input);
}

export async function updateTagRecord(
  tagId: string,
  input: { name?: string; color?: string | null },
): Promise<Tag> {
  return tagsFolders.updateTagRecord(tagId, input);
}

export async function deleteTag(tagId: string): Promise<void> {
  return tagsFolders.deleteTag(tagId);
}

export function subscribeFolderTree(
  onUpdate: (tree: FolderTreeNode[]) => void,
  handlers?: {
    onError?: (scope: string, error: unknown) => void;
  },
  signal?: AbortSignal,
): void {
  if (isDevMock()) {
    void devMockCollector
      .listFolderTree()
      .then(onUpdate)
      .catch((error: unknown) => {
        handlers?.onError?.("folder tree", error);
        onUpdate([]);
      });
    return;
  }
  tagsFolders.subscribeFolderTree(onUpdate, handlers, signal);
}

export async function loadFolderTree(): Promise<FolderTreeNode[]> {
  return tagsFolders.loadFolderTree();
}

export async function listFolderTree(): Promise<FolderTreeNode[]> {
  if (isDevMock()) {
    return devMockCollector.listFolderTree();
  }
  return tagsFolders.listFolderTree();
}

export async function createFolder(folderPath: string): Promise<string> {
  return tagsFolders.createFolder(folderPath);
}

export async function renameFolder(
  oldPath: string,
  newPath: string,
): Promise<string> {
  return tagsFolders.renameFolder(oldPath, newPath);
}

export async function deleteFolder(folderPath: string): Promise<void> {
  return tagsFolders.deleteFolder(folderPath);
}

export async function moveItemToFolderPath(
  itemId: string,
  folderPath: string,
): Promise<ItemFile> {
  return tagsFolders.moveItemToFolderPath(itemId, folderPath);
}

export async function listItemMedia(itemId: string): Promise<MediaWithPath[]> {
  if (isDevMock()) {
    return devMockCollector.listItemMedia(itemId);
  }
  return mediaCover.listItemMedia(itemId);
}

export async function resolveItemThumbnailPath(item: ItemFile): Promise<string | null> {
  if (isDevMock()) {
    return devMockCollector.resolveItemThumbnailPath(item);
  }
  return mediaCover.resolveItemThumbnailPath(item);
}

export async function resolveItemThumbnailPaths(
  items: ItemFile[],
): Promise<Map<string, string | null>> {
  if (isDevMock()) {
    const resolved = new Map<string, string | null>();
    for (const item of items) {
      resolved.set(item.id, await devMockCollector.resolveItemThumbnailPath(item));
    }
    return resolved;
  }
  return mediaCover.resolveItemThumbnailPaths(items);
}

export async function setItemCoverFromMedia(
  itemId: string,
  mediaId: string,
): Promise<ItemFile> {
  return mediaCover.setItemCoverFromMedia(itemId, mediaId);
}

export async function attachMediaFiles(
  itemId: string,
  files: Array<{ filename: string; data: Uint8Array }>,
): Promise<MediaFileMeta[]> {
  return mediaCover.attachMediaFiles(itemId, files);
}

export async function deleteItemMedia(
  itemId: string,
  mediaId: string,
): Promise<void> {
  return mediaCover.deleteItemMedia(itemId, mediaId);
}
