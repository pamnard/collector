import { appDataDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import type { ItemFile, VaultMeta } from "@collector/shared";
import type { MediaFileMeta } from "@collector/shared";
import { createCollectorIndexBoot, createItemsSearchService } from "@collector/service";
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
  createSingleFlight,
  createVault,
  assertVaultTreeLayout,
  readVaultMeta,
  runEmptyVaultBootstrap,
  syncVaultIndexFromFilesystem,
  upsertItem,
  vaultMetaPath,
  vaultRoot,
  vaultsRoot,
  writeVaultMeta,
  createTag as createTagOnVault,
  deleteTag as deleteTagOnVault,
  listTagsWithCounts,
  updateTag as updateTagOnVault,
  createFolder as createFolderOnVault,
  deleteFolder as deleteFolderOnVault,
  listFolderTreeFromIndex,
  moveItemToFolder,
  renameFolder as renameFolderOnVault,
  attachMediaFile,
  deleteMediaFile,
  listItemMediaWithPaths,
  applyItemCover,
  clearItemCover,
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

let dataDir = "";
let activeVault: { meta: VaultMeta; path: string } | null = null;
const syncedVaultIds = new Set<string>();
const vaultSyncPromises = new Map<string, Promise<void>>();
/** Watcher start/runtime failure: fall back to reconcile once, do not loop start→fail→resync. */
const watcherDisabledVaultIds = new Set<string>();
const fs = new TauriFileSystemAdapter();

configureVaultFilesystemWatcher({
  getContext,
  getActiveVaultId: () => activeVault?.meta.id ?? null,
  onItemsSynced: (vaultId) => {
    emitVaultSyncEvent(vaultId, "complete");
  },
  forceVaultIndexResync: (vaultId, vaultPath) => {
    forceVaultIndexResync(vaultId, vaultPath, { restartWatcher: false });
  },
});

export interface VaultIndexSyncStatus {
  vaultId: string | null;
  status: "idle" | "rebuilding" | "running" | "done";
  progress: IndexSyncProgress | null;
  /** True while metadata is queryable: optimistic at sync start, false only while Phase A work is confirmed in flight, then true again after onMetadataComplete / done. */
  metadataReady: boolean;
  /** True after Phase B (content/FTS) completes / sync done. */
  ftsReady: boolean;
}

type VaultSyncListener = {
  onProgress?: (progress: IndexSyncProgress) => void;
  onBatch?: (progress: IndexSyncProgress) => void;
  onComplete?: () => void;
};

const vaultSyncListeners = new Map<string, Set<VaultSyncListener>>();
const syncStatusListeners = new Set<(status: VaultIndexSyncStatus) => void>();
let vaultIndexSyncStatus: VaultIndexSyncStatus = {
  vaultId: null,
  status: "idle",
  progress: null,
  metadataReady: true,
  ftsReady: true,
};

function setVaultIndexSyncStatus(next: VaultIndexSyncStatus): void {
  vaultIndexSyncStatus = next;
  for (const listener of syncStatusListeners) {
    listener(next);
  }
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
  onUpdate(vaultIndexSyncStatus);
  syncStatusListeners.add(onUpdate);
  return () => {
    syncStatusListeners.delete(onUpdate);
  };
}

export function getVaultIndexSyncStatus(): VaultIndexSyncStatus {
  return vaultIndexSyncStatus;
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

type VaultEntry = { meta: VaultMeta; path: string };

/** Vault dirs are UUID folders only — skip backups / stray names under vaults/. */
const VAULT_DIR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listVaultEntries(): Promise<VaultEntry[]> {
  await ensureInitialized();
  const root = vaultsRoot(dataDir);
  if (!(await fs.exists(root))) {
    return [];
  }

  const entries: VaultEntry[] = [];
  for (const vaultId of await fs.readDir(root)) {
    if (!VAULT_DIR_ID_RE.test(vaultId)) {
      continue;
    }
    const path = vaultRoot(root, vaultId);
    if (await fs.exists(vaultMetaPath(path))) {
      // Do not assert layout here: orphan/legacy neighbors must not block listing
      // or opening a healthy active vault. Assert only when selecting a vault.
      const meta = await readVaultMeta(fs, path);
      entries.push({ meta, path });
    }
  }

  return entries.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
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
    activeVault = null;
    await stopVaultFilesystemWatcher();
  },
  onUnhealthyRebuildFinally: () => {
    if (vaultIndexSyncStatus.status === "rebuilding") {
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

function pickVaultEntry(
  entries: VaultEntry[],
  preferredId: string | null,
): VaultEntry | null {
  if (preferredId) {
    const stored = entries.find((entry) => entry.meta.id === preferredId);
    if (stored) {
      return stored;
    }
  }

  const defaultVault = entries.find((entry) => entry.meta.is_default);
  if (defaultVault) {
    return defaultVault;
  }

  return entries[0] ?? null;
}

const resolveActiveVaultShared = createSingleFlight(async () => {
  if (activeVault) {
    return { vault: activeVault.meta, path: activeVault.path };
  }

  const ctx = getContext();
  const root = vaultsRoot(dataDir);
  await fs.mkdir(root);

  const settings = await ensureAppSettings();
  const storedVaultId = settings.active_vault_id ?? null;
  const existing = await listVaultEntries();
  const selected = pickVaultEntry(existing, storedVaultId);

  let meta: VaultMeta | null = selected?.meta ?? null;
  let vaultPath = selected?.path ?? "";

  if (!meta) {
    const bootstrapped = await runEmptyVaultBootstrap(fs, root, {
      tryResolveExisting: async () => {
        const existingAfterLock = await listVaultEntries();
        const selectedAfterLock = pickVaultEntry(existingAfterLock, storedVaultId);
        if (!selectedAfterLock) {
          return null;
        }
        await assertVaultTreeLayout(fs, selectedAfterLock.path);
        return {
          meta: selectedAfterLock.meta,
          path: selectedAfterLock.path,
        };
      },
      create: async () => {
        const created = await createVault(ctx, dataDir, {
          name: "Default Vault",
          isDefault: true,
        });

        await upsertItem(ctx, created.path, created.meta.id, {
          item: {
            id: `${crypto.randomUUID()}.md`,
            vault_id: created.meta.id,
            title: "Welcome to Collector",
            description:
              "First offline item stored on disk and indexed in SQLite.",
            content_type: "note",
            source_type: "manual",
            metadata: {},
            tag_ids: [],
            collection_ids: [],
            folder_path: "",
            content_revision: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          content: "# Collector\n\nOffline vault is working.",
        });

        await updateAppSettings({ active_vault_id: created.meta.id });
        return { meta: created.meta, path: created.path };
      },
    });
    meta = bootstrapped.meta;
    vaultPath = bootstrapped.path;
  } else {
    await assertVaultTreeLayout(fs, vaultPath);
  }

  activeVault = { meta, path: vaultPath };
  return { vault: meta, path: vaultPath };
});

async function resolveActiveVault(): Promise<{ vault: VaultMeta; path: string }> {
  await ensureInitialized();

  if (activeVault) {
    return { vault: activeVault.meta, path: activeVault.path };
  }

  return resolveActiveVaultShared();
}

export async function ensureActiveVault(): Promise<{
  vault: VaultMeta;
  path: string;
}> {
  if (isDevMock()) {
    return devMockCollector.ensureActiveVault();
  }
  return resolveActiveVault();
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
  const entries = await listVaultEntries();
  return entries.map((entry) => entry.meta);
}

export async function getActiveVaultMeta(): Promise<VaultMeta> {
  const { vault } = await resolveActiveVault();
  return vault;
}

export async function switchVault(vaultId: string): Promise<VaultMeta> {
  const entries = await listVaultEntries();
  const selected = entries.find((entry) => entry.meta.id === vaultId);
  if (!selected) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  await assertVaultTreeLayout(fs, selected.path);

  activeVault = selected;
  watcherDisabledVaultIds.delete(vaultId);
  await stopVaultFilesystemWatcher();
  await clearDashboardSnapshot();
  await updateAppSettings({ active_vault_id: vaultId });
  return selected.meta;
}

export async function setDefaultVault(vaultId: string): Promise<void> {
  const ctx = getContext();
  const entries = await listVaultEntries();
  const selected = entries.find((entry) => entry.meta.id === vaultId);
  if (!selected) {
    throw new Error(`Vault not found: ${vaultId}`);
  }

  const timestamp = new Date().toISOString();
  for (const entry of entries) {
    const isDefault = entry.meta.id === vaultId;
    if (entry.meta.is_default === isDefault) {
      continue;
    }

    const updated: VaultMeta = {
      ...entry.meta,
      is_default: isDefault,
      updated_at: timestamp,
    };
    await writeVaultMeta(fs, entry.path, updated);
    await ctx.index.upsertVault(updated, entry.path);

    if (activeVault?.meta.id === entry.meta.id) {
      activeVault = { meta: updated, path: entry.path };
    }
  }
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

  void (async () => {
    const { vault, path } = await resolveActiveVault();
    if (signal?.aborted) {
      return;
    }

    const publish = async () => {
      try {
        const tags = await listTagsWithCounts(getContext(), vault.id);
        if (!signal?.aborted) {
          onUpdate(tags);
        }
      } catch (error) {
        handlers?.onError?.("tags publish", error);
      }
    };

    const republish = createThrottledPublisher(() => {
      void publish();
    }, SYNC_REPUBLISH_THROTTLE_MS);

    const unsub = addVaultSyncListener(vault.id, {
      onBatch: () => {
        republish.schedule();
      },
      onComplete: () => {
        republish.flush();
      },
    });

    const onAbort = () => {
      republish.cancel();
      unsub();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    await publish();
    kickoffVaultIndexSync(vault.id, path);
  })().catch((error: unknown) => {
    handlers?.onError?.("tags subscribe", error);
    if (!signal?.aborted) {
      onUpdate([]);
    }
  });
}

export async function listTags(): Promise<TagWithCount[]> {
  if (isDevMock()) {
    return devMockCollector.listTags();
  }

  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return listTagsWithCounts(getContext(), vault.id);
}

export async function createTag(input: {
  name: string;
  color?: string | null;
}): Promise<Tag> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return createTagOnVault(getContext(), path, vault.id, input);
}

export async function updateTagRecord(
  tagId: string,
  input: { name?: string; color?: string | null },
): Promise<Tag> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return updateTagOnVault(getContext(), path, vault.id, tagId, input);
}

export async function deleteTag(tagId: string): Promise<void> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  await deleteTagOnVault(getContext(), path, vault.id, tagId);
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

  void (async () => {
    const { vault, path } = await resolveActiveVault();
    if (signal?.aborted) {
      return;
    }

    const ctx = getContext();

    const publish = async () => {
      if (signal?.aborted) {
        return;
      }
      try {
        onUpdate(await listFolderTreeFromIndex(ctx, path, vault.id));
      } catch (error: unknown) {
        handlers?.onError?.("folder tree index", error);
        if (!signal?.aborted) {
          onUpdate([]);
        }
      }
    };

    const republish = createThrottledPublisher(() => {
      void publish();
    }, SYNC_REPUBLISH_THROTTLE_MS);

    const unsub = addVaultSyncListener(vault.id, {
      onBatch: () => {
        republish.schedule();
      },
      onComplete: () => {
        republish.flush();
      },
    });

    const onAbort = () => {
      republish.cancel();
      unsub();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    await publish();
    kickoffVaultIndexSync(vault.id, path);
  })().catch((error: unknown) => {
    handlers?.onError?.("folder tree", error);
    if (!signal?.aborted) {
      onUpdate([]);
    }
  });
}

export async function loadFolderTree(): Promise<FolderTreeNode[]> {
  return listFolderTree();
}

export async function listFolderTree(): Promise<FolderTreeNode[]> {
  if (isDevMock()) {
    return devMockCollector.listFolderTree();
  }

  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return listFolderTreeFromIndex(getContext(), path, vault.id);
}

export async function createFolder(folderPath: string): Promise<string> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return createFolderOnVault(getContext(), path, folderPath);
}

export async function renameFolder(
  oldPath: string,
  newPath: string,
): Promise<string> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return renameFolderOnVault(getContext(), path, vault.id, oldPath, newPath);
}

export async function deleteFolder(folderPath: string): Promise<void> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  await deleteFolderOnVault(getContext(), path, vault.id, folderPath);
}

export async function moveItemToFolderPath(
  itemId: string,
  folderPath: string,
): Promise<ItemFile> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return moveItemToFolder(getContext(), path, vault.id, itemId, folderPath);
}

export async function listItemMedia(itemId: string): Promise<MediaWithPath[]> {
  if (isDevMock()) {
    return devMockCollector.listItemMedia(itemId);
  }

  const { path } = await resolveActiveVault();
  return listItemMediaWithPaths(getContext(), path, itemId);
}

async function syncItemCover(itemId: string): Promise<void> {
  const { vault, path } = await resolveActiveVault();
  const ctx = getContext();
  const media = await listItemMediaWithPaths(ctx, path, itemId);
  const candidate =
    media.find((file) => file.media_type === "image") ??
    media.find((file) => file.media_type === "video");

  if (!candidate) {
    await clearItemCover(ctx, path, vault.id, itemId);
    return;
  }

  const data = await fs.readBinary(candidate.absolute_path);
  const cover = await generateCoverFromMedia(
    data,
    candidate.filename,
    candidate.media_type,
  );

  if (cover) {
    await applyItemCover(ctx, path, vault.id, itemId, cover);
  } else {
    await clearItemCover(ctx, path, vault.id, itemId);
  }
}

export async function resolveItemThumbnailPath(item: ItemFile): Promise<string | null> {
  const paths = await resolveItemThumbnailPaths([item]);
  return paths.get(item.id) ?? null;
}

const itemThumbnailPathCache = new Map<
  string,
  { cacheKey: string; path: string | null }
>();

function itemThumbnailCacheKey(item: ItemFile): string {
  return `${item.thumbnail ?? ""}:${item.updated_at}`;
}

async function resolveItemThumbnailPathsUncached(
  items: ItemFile[],
): Promise<Map<string, string | null>> {
  if (!items.length) {
    return new Map();
  }

  if (isDevMock()) {
    const resolved = new Map<string, string | null>();
    for (const item of items) {
      resolved.set(item.id, await devMockCollector.resolveItemThumbnailPath(item));
    }
    return resolved;
  }

  const { path } = await resolveActiveVault();
  const rows = await invoke<Array<{ id: string; path: string | null }>>(
    "resolve_item_thumbnail_paths",
    {
      vaultPath: path,
      items: items.map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
      })),
    },
  );

  const resolved = new Map<string, string | null>();
  for (const row of rows) {
    resolved.set(row.id, row.path);
  }
  return resolved;
}

export async function resolveItemThumbnailPaths(
  items: ItemFile[],
): Promise<Map<string, string | null>> {
  if (!items.length) {
    return new Map();
  }

  const uncached: ItemFile[] = [];
  const resolved = new Map<string, string | null>();

  for (const item of items) {
    const cacheKey = itemThumbnailCacheKey(item);
    const cached = itemThumbnailPathCache.get(item.id);
    if (cached && cached.cacheKey === cacheKey) {
      resolved.set(item.id, cached.path);
      continue;
    }
    uncached.push(item);
  }

  if (uncached.length) {
    const fresh = await resolveItemThumbnailPathsUncached(uncached);
    for (const item of uncached) {
      const path = fresh.get(item.id) ?? null;
      itemThumbnailPathCache.set(item.id, {
        cacheKey: itemThumbnailCacheKey(item),
        path,
      });
      resolved.set(item.id, path);
    }
  }

  return resolved;
}

export async function setItemCoverFromMedia(
  itemId: string,
  mediaId: string,
): Promise<ItemFile> {
  const { vault, path } = await resolveActiveVault();
  const ctx = getContext();
  const media = await listItemMediaWithPaths(ctx, path, itemId);
  const file = media.find((entry) => entry.id === mediaId);

  if (!file) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  if (file.media_type !== "image" && file.media_type !== "video") {
    throw new Error("Cover can only be set from image or video files");
  }

  const data = await fs.readBinary(file.absolute_path);
  const cover = await generateCoverFromMedia(
    data,
    file.filename,
    file.media_type,
  );

  if (!cover) {
    throw new Error("Failed to generate cover from media");
  }

  return applyItemCover(ctx, path, vault.id, itemId, cover);
}

export async function attachMediaFiles(
  itemId: string,
  files: Array<{ filename: string; data: Uint8Array }>,
): Promise<MediaFileMeta[]> {
  const { path } = await resolveActiveVault();
  const ctx = getContext();
  const attached: MediaFileMeta[] = [];
  for (const file of files) {
    attached.push(
      await attachMediaFile(ctx, path, itemId, {
        filename: file.filename,
        data: file.data,
      }),
    );
  }
  await syncItemCover(itemId);
  return attached;
}

export async function deleteItemMedia(
  itemId: string,
  mediaId: string,
): Promise<void> {
  const { path } = await resolveActiveVault();
  await deleteMediaFile(getContext(), path, itemId, mediaId);
  await syncItemCover(itemId);
}
