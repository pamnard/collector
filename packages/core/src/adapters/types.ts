import type { ItemFile, MediaFileMeta, SourceRef, Tag, VaultMeta } from "@collector/shared";
import type { NavSearchFilter } from "../search/nav-filter.js";

export interface VaultItemStatMeta {
  /** Vault-relative posix path of the markdown item (e.g. `Inbox/note.md`). */
  id: string;
  mtimeMs: number | null;
}

export interface VaultItemMetaRead {
  /** Vault-relative posix path of the markdown item (e.g. `Inbox/note.md`). */
  id: string;
  documentMarkdown: string;
  mtimeMs?: number | null;
}

export interface VaultItemSourceRefRead {
  /** Vault-relative posix path of the markdown item (e.g. `Inbox/note.md`). */
  id: string;
  /** Raw JSON text, or null if sidecar missing. */
  sourceJson: string | null;
}

/** Directory listing entry with file-vs-directory bit (#278). */
export interface VaultDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileSystemAdapter {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  /**
   * Create a new text file exclusively (fail if path already exists).
   * Node: `flag: 'wx'`. Tauri: Rust `create_new`. Used for cross-process locks.
   */
  writeTextExclusive(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, content: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  /** Like `readDir`, but includes whether each entry is a directory. */
  readDirEntries(path: string): Promise<VaultDirEntry[]>;
  stat(path: string): Promise<{ mtimeMs: number | null }>;
  touch(path: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Move/rename a file or directory (used for folder renames + item moves). */
  rename(from: string, to: string): Promise<void>;
  join(...parts: string[]): string;
  /** One host round-trip: recursively stat every markdown item `.md` file under vault root. */
  statVaultItemsMeta?(vaultPath: string): Promise<VaultItemStatMeta[]>;
  /** One host round-trip per chunk: read markdown documents for the given vault-relative paths. */
  readVaultItemsMeta?(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemMetaRead[]>;
  /** One host round-trip per chunk: read source reference sidecars for the given item paths. */
  readVaultItemSourceRefs?(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemSourceRefRead[]>;
}

export interface ItemSyncMeta {
  id: string;
  file_mtime_ms: number | null;
  updated_at: string;
  content_revision: number;
  created_at: string;
}

export interface ItemSyncMetaPatch {
  fileMtimeMs: number;
  updatedAt: string;
  contentRevision: number;
  createdAt: string;
}

export interface ReconcileFingerprint {
  itemsDirMtimeMs: number;
  itemCount: number;
}

export interface IndexedItem {
  item: ItemFile;
  /** Full on-disk markdown (frontmatter + body) for FTS (#534). */
  content: string | null;
  /** Non-empty markdown body present — not derived from FTS content string. */
  hasContentFile: boolean;
  sourceRef: SourceRef | null;
  fileMtimeMs?: number | null;
}

/** List/filter fields only — no content read, FTS without body (#71 Phase A). */
export interface IndexedItemMetadata {
  item: ItemFile;
  fileMtimeMs?: number | null;
}

/** Content + source_ref + FTS document after metadata is already in the index (#71 Phase B). */
export interface ItemContentUpsert {
  itemId: string;
  title: string;
  description: string;
  /** Full on-disk markdown (frontmatter + body) for FTS (#534). */
  content: string | null;
  /** Non-empty markdown body present — not derived from FTS content string. */
  hasContentFile: boolean;
  sourceRef: SourceRef | null;
}

export interface ItemIdRewriteMapping {
  oldId: string;
  newId: string;
  folderPath: string;
}

/** Anchor for exact-folder chronological neighbors (#344). */
export interface AdjacentItemAnchor {
  id: string;
  folder_path: string;
  created_at: string;
}

export interface AdjacentItemRef {
  id: string;
  title: string;
}

export interface AdjacentItemsResult {
  prev: AdjacentItemRef | null;
  next: AdjacentItemRef | null;
}

export interface VaultIndexAdapter {
  upsertVault(meta: VaultMeta, vaultPath: string): Promise<void>;
  deleteVault(vaultId: string): Promise<void>;
  upsertItem(record: IndexedItem, vaultId: string): Promise<void>;
  upsertItemMetadata(record: IndexedItemMetadata, vaultId: string): Promise<void>;
  upsertItemMetadataBatch(
    records: IndexedItemMetadata[],
    vaultId: string,
  ): Promise<void>;
  upsertItemContent(input: ItemContentUpsert): Promise<void>;
  upsertItemContentBatch(inputs: ItemContentUpsert[]): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  /** Copy index rows oldId → newId after a directory rename (no vault FS reads). */
  rewriteItemIds(mappings: ItemIdRewriteMapping[]): Promise<void>;
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
  /**
   * Chronological neighbors in the exact same folder (#344).
   * `prev` = older, `next` = newer; tie-break by `id`.
   */
  getAdjacentItems(
    vaultId: string,
    anchor: AdjacentItemAnchor,
  ): Promise<AdjacentItemsResult>;
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
  listItemSyncMetaByIds(
    vaultId: string,
    itemIds: string[],
  ): Promise<ItemSyncMeta[]>;
  patchItemSyncMeta(itemId: string, meta: ItemSyncMetaPatch): Promise<void>;
  patchItemSyncMetaBatch(
    patches: Array<{ itemId: string } & ItemSyncMetaPatch>,
  ): Promise<void>;
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
  /** Server-side ORDER BY for listItemIds* (#339). Unknown keys rejected. */
  sort?: { key: string; dir: "asc" | "desc" };
}

export type ItemIdListOptions = ItemIdPageOptions;

/** Refresh disposable item embeddings after index writes (#413). */
export type ItemEmbeddingRefreshInput = {
  itemId: string;
  title: string;
  description: string;
  tagNames: string[];
  body?: string;
  contentRevision: number;
};

export type ItemEmbeddingsPort = {
  refresh(inputs: ItemEmbeddingRefreshInput[]): Promise<void>;
};

export interface VaultContext {
  fs: FileSystemAdapter;
  index: VaultIndexAdapter;
  /** When set, item index writes refresh semantic vectors (#413). */
  embeddings?: ItemEmbeddingsPort;
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
  /**
   * Fired after Phase A (metadata) completes and before Phase B (content/FTS).
   * Also fired on reconcile fast-path / missing-vault no-op so callers can clear
   * "metadata not ready" UI without waiting for the whole sync promise.
   */
  onMetadataComplete?: (
    progress: IndexSyncProgress,
  ) => void | Promise<void>;
}

