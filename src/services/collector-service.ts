import { appDataDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { ensureHealthyIndex, runMigrations, resetIndexSchema } from "@collector/db";
import type { ItemFile, VaultMeta } from "@collector/shared";
import type { MediaFileMeta } from "@collector/shared";
import {
  SqlVaultIndexStore,
  buildFtsMatchQuery,
  createSingleFlight,
  createTwoPhaseBootGate,
  createVault,
  deleteItem as deleteItemOnDisk,
  itemRoot,
  listItemsByIds,
  listItemsOnDisk,
  migrateVaultSchema,
  readItemContent,
  readItemFile,
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
import { isFolderFilter, isTagFilter } from "../types/ui";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { TauriSqlAdapter } from "../adapters/tauri-sql";
import {
  ensureAppSettings,
  updateAppSettings,
} from "./app-settings-service";
import { generateCoverFromMedia } from "./thumbnail-service";
import { getLegacyIndexDatabasePaths } from "./index-db-path";
import { reportServiceError } from "./runtime-error";
import { isDevMock } from "../dev/is-dev-mock";
import * as devMockCollector from "../dev/mock-collector";

let dataDir = "";
let sql: TauriSqlAdapter | null = null;
let activeVault: { meta: VaultMeta; path: string } | null = null;
const syncedVaultIds = new Set<string>();
const vaultSyncPromises = new Map<string, Promise<void>>();
const fs = new TauriFileSystemAdapter();

export interface VaultIndexSyncStatus {
  vaultId: string | null;
  status: "idle" | "rebuilding" | "running" | "done";
  progress: IndexSyncProgress | null;
  /** True after Phase A (metadata) completes, or when sync finishes with nothing to reindex. */
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

type VaultEntry = { meta: VaultMeta; path: string };

async function listVaultEntries(): Promise<VaultEntry[]> {
  await ensureInitialized();
  const root = vaultsRoot(dataDir);
  if (!(await fs.exists(root))) {
    return [];
  }

  const entries: VaultEntry[] = [];
  for (const vaultId of await fs.readDir(root)) {
    const path = vaultRoot(root, vaultId);
    if (await fs.exists(vaultMetaPath(path))) {
      const meta = await migrateVaultSchema(fs, path);
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

async function rebuildIndexDatabase(): Promise<void> {
  if (!sql) {
    throw new Error("Collector database is not initialized");
  }

  syncedVaultIds.clear();
  vaultSyncPromises.clear();
  activeVault = null;
  await resetIndexSchema(sql);
  await runMigrations(sql);
}

async function runIndexHealthChecks(): Promise<void> {
  if (!sql) {
    throw new Error("Collector database is not initialized");
  }

  let health = await ensureHealthyIndex(sql);
  if (health.ok) {
    return;
  }

  console.warn(
    "[collector] SQLite index unhealthy, rebuilding from vault files:",
    health.errors,
  );
  setVaultIndexSyncStatus({
    vaultId: null,
    status: "rebuilding",
    progress: null,
    metadataReady: false,
    ftsReady: false,
  });

  try {
    await rebuildIndexDatabase();

    if (!sql) {
      throw new Error("Collector database rebuild failed to reopen");
    }

    health = await ensureHealthyIndex(sql);
    if (!health.ok) {
      throw new Error(
        `Index database failed startup checks: ${health.errors.join("; ")}`,
      );
    }
  } finally {
    if (vaultIndexSyncStatus.status === "rebuilding") {
      setVaultIndexSyncStatus({
        vaultId: null,
        status: "idle",
        progress: null,
        metadataReady: false,
        ftsReady: false,
      });
    }
  }
}

async function openCollectorDatabaseInternal(): Promise<void> {
  let opened: TauriSqlAdapter | null = null;

  try {
    dataDir = await join(await appDataDir(), "collector");
    await fs.mkdir(dataDir);
    await removeLegacyIndexDatabaseFiles();
    opened = await TauriSqlAdapter.open();
    sql = opened;
    await runMigrations(sql);
  } catch (err) {
    if (opened) {
      await opened.close().catch(() => {});
      sql = null;
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

const bootGate = createTwoPhaseBootGate({
  open: openCollectorDatabaseInternal,
  health: runIndexHealthChecks,
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
  await bootGate.open();
}

/**
 * Finish index health checks (and schema rebuild if needed).
 * All UI SQL queries go through {@link ensureInitialized}, which awaits this.
 */
export async function ensureCollectorDatabaseHealthy(): Promise<void> {
  if (isDevMock()) {
    return;
  }
  await bootGate.ensureHealthy();
}

/** @deprecated Prefer {@link openCollectorDatabase} for boot; kept for mock callers. */
export async function warmupCollector(): Promise<void> {
  await openCollectorDatabase();
}

async function ensureInitialized(): Promise<void> {
  if (isDevMock()) {
    await devMockCollector.warmupCollector();
    return;
  }
  await bootGate.ensureHealthy();
}

function getIndex(): SqlVaultIndexStore {
  if (!sql || !bootGate.isHealthy()) {
    throw new Error("Collector database is not initialized");
  }
  return new SqlVaultIndexStore(sql);
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

  let metadataReady = false;
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

  const promise = (async () => {
    try {
      const report = await syncVaultIndexFromFilesystem(getContext(), vaultPath, {
        onProgress: (progress) => {
          latestProgress = progress;
          publishRunningStatus.schedule();
          emitVaultSyncEvent(vaultId, "progress", progress);
        },
        onBatch: (progress) => {
          latestProgress = progress;
          publishRunningStatus.schedule();
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
    const created = await createVault(ctx, dataDir, {
      name: "Default Vault",
      isDefault: true,
    });
    meta = created.meta;
    vaultPath = created.path;

    await upsertItem(ctx, vaultPath, meta.id, {
      item: {
        id: crypto.randomUUID(),
        vault_id: meta.id,
        title: "Welcome to Collector",
        description: "First offline item stored on disk and indexed in SQLite.",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: true,
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "# Collector\n\nOffline vault is working.",
    });
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

/** @deprecated use ensureActiveVault */
export async function bootstrapDevVault(): Promise<{
  vault: VaultMeta;
  path: string;
  items: ItemFile[];
}> {
  const { vault, path } = await resolveActiveVault();
  const items = await listItemsOnDisk(getContext(), path);
  return { vault, path, items };
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

export async function listItems(): Promise<ItemFile[]> {
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);
  return listItemsOnDisk(getContext(), path);
}

export async function searchItems(
  query: string,
  filter: NavFilter,
): Promise<ItemFile[]> {
  const ftsQuery = buildFtsMatchQuery(query);
  const { vault, path } = await resolveActiveVault();
  kickoffVaultIndexSync(vault.id, path);

  if (!ftsQuery) {
    if (isTagFilter(filter)) {
      const itemIds = await getIndex().listItemIdsByTag(vault.id, filter.tagId);
      return listItemsByIds(getContext(), path, itemIds);
    }
    if (isFolderFilter(filter)) {
      const itemIds = await getIndex().listItemIdsByFolderPrefix(
        vault.id,
        filter.folderPath,
      );
      return listItemsByIds(getContext(), path, itemIds);
    }

    const items = await listItemsOnDisk(getContext(), path);
    return items.filter((item) => matchesNavFilter(item, filter));
  }

  const itemIds = await getIndex().searchItemIds(vault.id, ftsQuery, filter);
  return listItemsByIds(getContext(), path, itemIds);
}

export const DASHBOARD_PREFETCH_SIZE = 60;
/** @deprecated Use DASHBOARD_PREFETCH_SIZE — window size, not a concurrency limit. */
export const DASHBOARD_BATCH_SIZE = DASHBOARD_PREFETCH_SIZE;
const DASHBOARD_SEARCH_LIMIT = 10_000;

export interface DashboardItemIdsResult {
  itemIds: string[];
  indexSync: Promise<void>;
}

async function queryDashboardItemIds(
  vaultId: string,
  filter: NavFilter,
  query: string,
): Promise<string[]> {
  const trimmedSearch = query.trim();

  if (!trimmedSearch) {
    return getIndex().listItemIdsByNavFilter(vaultId, filter);
  }

  const ftsQuery = buildFtsMatchQuery(trimmedSearch);
  if (!ftsQuery) {
    return getIndex().listItemIdsByNavFilter(vaultId, filter);
  }

  return getIndex().searchItemIds(
    vaultId,
    ftsQuery,
    filter,
    DASHBOARD_SEARCH_LIMIT,
  );
}

export async function listDashboardItemIds(
  filter: NavFilter,
  query = "",
): Promise<DashboardItemIdsResult> {
  if (isDevMock()) {
    const itemIds = await devMockCollector.listDashboardItemIds(filter, query);
    return { itemIds, indexSync: Promise.resolve() };
  }

  const { vault, path } = await resolveActiveVault();
  const indexSync = startVaultIndexSync(vault.id, path);
  const itemIds = await queryDashboardItemIds(vault.id, filter, query);
  return { itemIds, indexSync };
}

export function subscribeDashboardLoad(
  filter: NavFilter,
  query: string,
  handlers: {
    onIndexIds: (itemIds: string[]) => void;
    onLoadComplete?: () => void;
    onError?: (scope: string, error: unknown) => void;
  },
  signal?: AbortSignal,
): void {
  if (isDevMock()) {
    void devMockCollector
      .listDashboardItemIds(filter, query)
      .then((itemIds) => {
        handlers.onIndexIds(itemIds);
        handlers.onLoadComplete?.();
      })
      .catch((error: unknown) => {
        handlers.onError?.("dashboard load", error);
      });
    return;
  }

  void (async () => {
    const { vault, path } = await resolveActiveVault();
    if (signal?.aborted) {
      return;
    }

    const publishIds = async () => {
      try {
        const itemIds = await queryDashboardItemIds(vault.id, filter, query);
        if (!signal?.aborted) {
          handlers.onIndexIds(itemIds);
        }
      } catch (error: unknown) {
        handlers.onError?.("dashboard index ids", error);
        if (!signal?.aborted) {
          handlers.onIndexIds([]);
        }
      }
    };

    const republish = createThrottledPublisher(() => {
      void publishIds();
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

    await publishIds();
    if (!signal?.aborted) {
      handlers.onLoadComplete?.();
    }
    kickoffVaultIndexSync(vault.id, path);
  })().catch((error: unknown) => {
    handlers.onError?.("dashboard load", error);
  });
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

  if (!itemIds.length || offset >= itemIds.length || limit <= 0) {
    return;
  }

  if (signal?.aborted) {
    return;
  }

  const { vault } = await resolveActiveVault();
  if (signal?.aborted) {
    return;
  }

  const batchIds = itemIds.slice(offset, offset + limit);
  const items = await getIndex().listItemFilesByIds(vault.id, batchIds);

  for (const item of items) {
    if (signal?.aborted) {
      return;
    }
    onItem(item);
  }
}

export async function loadDashboardItems(
  itemIds: string[],
  offset: number,
  limit = DASHBOARD_PREFETCH_SIZE,
): Promise<ItemFile[]> {
  if (isDevMock()) {
    return devMockCollector.loadDashboardItems(itemIds, offset, limit);
  }

  if (!itemIds.length || offset >= itemIds.length) {
    return [];
  }

  const items: ItemFile[] = [];
  await streamDashboardItems(itemIds, offset, limit, (item) => {
    items.push(item);
  });
  return items;
}

function matchesNavFilter(item: ItemFile, filter: NavFilter): boolean {
  if (isTagFilter(filter)) {
    return !item.is_archived && item.tag_ids.includes(filter.tagId);
  }
  if (isFolderFilter(filter)) {
    if (item.is_archived) {
      return false;
    }
    const path = filter.folderPath;
    return (
      item.folder_path === path ||
      item.folder_path.startsWith(`${path}/`)
    );
  }
  if (filter === "all") {
    return !item.is_archived;
  }
  if (filter === "favorite") {
    return item.is_favorite;
  }
  return item.is_archived;
}

export async function getItemById(
  itemId: string,
): Promise<{ item: ItemFile; content: string | null }> {
  const { path } = await resolveActiveVault();
  const itemPath = itemRoot(path, itemId);

  if (!(await fs.exists(itemPath))) {
    throw new Error(`Item not found: ${itemId}`);
  }

  const item = await readItemFile(fs, itemPath);
  const content = await readItemContent(fs, itemPath);
  return { item, content };
}

export async function createItem(input: CreateItemInput): Promise<ItemFile> {
  const { vault, path } = await resolveActiveVault();
  const timestamp = new Date().toISOString();

  return upsertItem(getContext(), path, vault.id, {
    item: {
      id: crypto.randomUUID(),
      vault_id: vault.id,
      title: input.title,
      description: input.description ?? "",
      url: input.url ?? null,
      content_type: input.content_type,
      source_type: "manual",
      metadata: {},
      is_archived: false,
      is_favorite: false,
      tag_ids: [],
      collection_ids: [],
      folder_path: "",
      content_revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    content: input.content ?? null,
  });
}

export async function updateItem(
  itemId: string,
  input: UpdateItemInput,
): Promise<ItemFile> {
  if (isDevMock()) {
    return devMockCollector.updateItem(itemId, input);
  }

  const { vault, path } = await resolveActiveVault();
  const { item: existing, content: existingContent } = await getItemById(itemId);

  return upsertItem(getContext(), path, vault.id, {
    item: {
      ...existing,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      url: input.url !== undefined ? input.url : existing.url,
      content_type: input.content_type ?? existing.content_type,
      is_favorite: input.is_favorite ?? existing.is_favorite,
      is_archived: input.is_archived ?? existing.is_archived,
      tag_ids: input.tag_ids ?? existing.tag_ids,
      folder_path: input.folder_path ?? existing.folder_path,
    },
    content: input.content !== undefined ? input.content : existingContent,
  });
}

export async function deleteItem(itemId: string): Promise<void> {
  const { path } = await resolveActiveVault();
  await deleteItemOnDisk(getContext(), path, itemId);
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

  activeVault = selected;
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
