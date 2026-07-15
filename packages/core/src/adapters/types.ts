import type { ItemFile, MediaFileMeta, SourceRef, Tag, VaultMeta } from "@collector/shared";
import type { NavSearchFilter } from "../search/nav-filter.js";

export interface VaultItemStatMeta {
  id: string;
  mtimeMs: number | null;
}

export interface VaultItemMetaRead {
  id: string;
  itemJson: string;
}

export interface FileSystemAdapter {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, content: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ mtimeMs: number | null }>;
  touch(path: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  join(...parts: string[]): string;
  /** One IPC: stat item.json mtimes for every item dir under vault. */
  statVaultItemsMeta?(vaultPath: string): Promise<VaultItemStatMeta[]>;
  /** One IPC per chunk: read item.json for the given ids. */
  readVaultItemsMeta?(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemMetaRead[]>;
}

export interface ItemSyncMeta {
  id: string;
  file_mtime_ms: number | null;
  updated_at: string;
  content_revision: number;
}

export interface ItemSyncMetaPatch {
  fileMtimeMs: number;
  updatedAt: string;
  contentRevision: number;
}

export interface ReconcileFingerprint {
  itemsDirMtimeMs: number;
  itemCount: number;
}

export interface IndexedItem {
  item: ItemFile;
  content: string | null;
  sourceRef: SourceRef | null;
  fileMtimeMs?: number | null;
}

/** List/filter fields only — no content read, FTS without body (#71 Phase A). */
export interface IndexedItemMetadata {
  item: ItemFile;
  fileMtimeMs?: number | null;
}

/** Content + source_ref + FTS body after metadata is already in the index (#71 Phase B). */
export interface ItemContentUpsert {
  itemId: string;
  title: string;
  description: string;
  content: string | null;
  sourceRef: SourceRef | null;
}

export interface VaultIndexAdapter {
  upsertVault(meta: VaultMeta, vaultPath: string): Promise<void>;
  deleteVault(vaultId: string): Promise<void>;
  upsertItem(record: IndexedItem, vaultId: string): Promise<void>;
  upsertItemMetadata(record: IndexedItemMetadata, vaultId: string): Promise<void>;
  upsertItemContent(input: ItemContentUpsert): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  upsertMedia(media: MediaFileMeta): Promise<void>;
  deleteMedia(mediaId: string): Promise<void>;
  deleteMediaForItem(itemId: string): Promise<void>;
  upsertTag(tag: Tag, vaultId: string): Promise<void>;
  deleteTag(tagId: string): Promise<void>;
  listTagsWithCounts(vaultId: string): Promise<
    Array<Tag & { item_count: number }>
  >;
  listItemIdsByTag(
    vaultId: string,
    tagId: string,
    options?: ItemIdListOptions,
  ): Promise<string[]>;
  listItemIdsByFolderPrefix(
    vaultId: string,
    folderPath: string,
    options?: ItemIdListOptions,
  ): Promise<string[]>;
  listItemIdsByNavFilter(
    vaultId: string,
    filter: NavSearchFilter,
    options?: ItemIdPageOptions,
  ): Promise<string[]>;
  countItemIdsByNavFilter(
    vaultId: string,
    filter: NavSearchFilter,
  ): Promise<number>;
  listFolderItemCounts(
    vaultId: string,
  ): Promise<Array<{ folder_path: string; item_count: number }>>;
  listVaultItemIds(vaultId: string): Promise<string[]>;
  listItemFilesByIds(vaultId: string, itemIds: string[]): Promise<ItemFile[]>;
  listVaultItemSyncMeta(vaultId: string): Promise<ItemSyncMeta[]>;
  patchItemSyncMeta(itemId: string, meta: ItemSyncMetaPatch): Promise<void>;
  getReconcileFingerprint(vaultId: string): Promise<ReconcileFingerprint | null>;
  setReconcileFingerprint(
    vaultId: string,
    fingerprint: ReconcileFingerprint,
  ): Promise<void>;
  searchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavSearchFilter,
    options?: ItemIdPageOptions,
  ): Promise<string[]>;
  countSearchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavSearchFilter,
  ): Promise<number>;
}

export interface ItemIdPageOptions {
  limit?: number;
  offset?: number;
}

export interface ItemIdListOptions extends ItemIdPageOptions {
  includeArchived?: boolean;
}

export interface VaultContext {
  fs: FileSystemAdapter;
  index: VaultIndexAdapter;
}

export interface CreateVaultInput {
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpsertItemInput {
  item: ItemFile;
  content?: string | null;
  sourceRef?: SourceRef | null;
}

export interface SyncReport {
  skipped: number;
  patched: number;
  /** Metadata rows written (list-visible). */
  indexed: number;
  /** Content/FTS body writes completed (Phase B). */
  contentIndexed: number;
  removed: number;
  errors: Array<{ itemId: string; message: string }>;
}

export type IndexSyncPhase = "metadata" | "content";

export interface IndexSyncProgress {
  phase: IndexSyncPhase;
  processed: number;
  total: number;
  skipped: number;
  patched: number;
  indexed: number;
  contentIndexed: number;
  removed: number;
}

export interface IndexSyncOptions {
  onProgress?: (progress: IndexSyncProgress) => void;
  onBatch?: (progress: IndexSyncProgress) => void;
  /** Fired after Phase A (metadata) completes and before Phase B (content/FTS). */
  onMetadataComplete?: (
    progress: IndexSyncProgress,
  ) => void | Promise<void>;
}

