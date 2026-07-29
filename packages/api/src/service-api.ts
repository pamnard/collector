import type { ItemFile, VaultMeta } from "@collector/shared";
import type {
  AttachMediaFileInput,
  CreateItemInput,
  FolderTreeNode,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
  IndexSyncProgress,
  MediaWithPath,
  NavFilter,
  TagWithCount,
  UpdateItemInput,
} from "./domain.js";
import type { Tag } from "@collector/shared";
import type { AppSettings, DashboardSnapshot } from "@collector/shared";
import type { MediaFileMeta } from "@collector/shared";

/** Matches `collector-service` `DASHBOARD_PREFETCH_SIZE`. */
export const DASHBOARD_PREFETCH_SIZE = 60;

/** Server-side dashboard ID list sort (#339). Keys must be allowlisted by the index. */
export type DashboardItemSortDir = "asc" | "desc";

export interface DashboardItemSort {
  key: string;
  dir: DashboardItemSortDir;
}

export interface VaultIndexSyncStatus {
  vaultId: string | null;
  status: "idle" | "rebuilding" | "running" | "done";
  progress: IndexSyncProgress | null;
  metadataReady: boolean;
  ftsReady: boolean;
}

export interface DashboardIndexPage {
  itemIds: string[];
  totalCount: number;
  offset: number;
}

/**
 * Canonical dashboard index page (#362). No Promise-in-DTO —
 * sync status lives on {@link IndexPort}.
 */
export interface IndexQueryResult {
  ids: string[];
  total: number;
  offset: number;
}

/**
 * @deprecated Prefer {@link IndexQueryResult} via {@link ItemsPort.queryIndex}.
 * `indexSync` is a Promise-in-DTO; use {@link IndexPort} subscribe/status instead (#163 / #362).
 */
export interface DashboardItemIdsResult {
  itemIds: string[];
  totalCount: number;
  /** @deprecated Promise-in-DTO — use IndexPort sync status. */
  indexSync: Promise<void>;
}

export interface ActiveVaultResult {
  vault: VaultMeta;
  path: string;
}

export interface GetItemResult {
  item: ItemFile;
  content: string | null;
}

export interface AdjacentItemRef {
  id: string;
  title: string;
}

export interface AdjacentItemsResult {
  prev: AdjacentItemRef | null;
  next: AdjacentItemRef | null;
}

export interface DashboardLoadHandlers {
  onIndexPage: (page: DashboardIndexPage) => void;
  getLoadedIdCount?: () => number;
  onLoadComplete?: () => void;
  onError?: (scope: string, error: unknown) => void;
}

export interface ServiceSubscribeHandlers {
  onError?: (scope: string, error: unknown) => void;
}

/** Boot / DB port (#361). */
export interface BootPort {
  openCollectorDatabase(): Promise<void>;
  ensureCollectorDatabaseHealthy(): Promise<void>;
  ensureActiveVault(): Promise<ActiveVaultResult>;
  getDataDirectory(): Promise<string>;
}

/** Items / search / dashboard loaders (#361 / #362). */
export interface ItemsPort {
  listItems(): Promise<ItemFile[]>;
  searchItems(query: string, filter: NavFilter): Promise<ItemFile[]>;
  /** Canonical index query: ids + total for a page (#362). */
  queryIndex(
    filter: NavFilter,
    query: string | undefined,
    page: { limit: number; offset: number },
    sort?: DashboardItemSort,
  ): Promise<IndexQueryResult>;
  /** Yield item bodies for known ids; honor AbortSignal (#362). */
  hydrate(
    ids: string[],
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ItemFile>;
  /** @deprecated Use {@link ItemsPort.queryIndex}. */
  fetchDashboardIndexPage(
    filter: NavFilter,
    query: string | undefined,
    page: { limit: number; offset: number },
    sort?: DashboardItemSort,
  ): Promise<DashboardIndexPage>;
  /** @deprecated Use {@link ItemsPort.queryIndex}; do not rely on `indexSync`. */
  listDashboardItemIds(
    filter: NavFilter,
    query?: string,
    sort?: DashboardItemSort,
  ): Promise<DashboardItemIdsResult>;
  /** @deprecated Compose {@link ItemsPort.queryIndex} + IndexPort subscribe in UI (#367). */
  subscribeDashboardLoad(
    filter: NavFilter,
    query: string,
    handlers: DashboardLoadHandlers,
    signal?: AbortSignal,
    sort?: DashboardItemSort,
  ): void;
  /** @deprecated Use {@link ItemsPort.hydrate}. */
  streamDashboardItems(
    itemIds: string[],
    offset: number,
    limit: number,
    onItem: (item: ItemFile) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /** @deprecated Use {@link ItemsPort.hydrate} (collect into an array at the call site). */
  loadDashboardItems(
    itemIds: string[],
    offset: number,
    limit?: number,
  ): Promise<ItemFile[]>;
  getItemById(itemId: string): Promise<GetItemResult>;
  /** Exact-folder chronological neighbors (#344). */
  getAdjacentItems(itemId: string): Promise<AdjacentItemsResult>;
  getItemSource(itemId: string): Promise<string>;
  updateItemSource(itemId: string, rawMarkdown: string): Promise<ItemFile>;
  createItem(input: CreateItemInput): Promise<ItemFile>;
  updateItem(itemId: string, input: UpdateItemInput): Promise<ItemFile>;
  deleteItem(itemId: string): Promise<void>;
  importDroppedFiles(
    input: ImportDroppedFilesInput,
  ): Promise<ImportDroppedFilesResult>;
}

/** Tags port (#361). */
export interface TagsPort {
  subscribeTags(
    onUpdate: (tags: TagWithCount[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): void;
  listTags(): Promise<TagWithCount[]>;
  createTag(input: { name: string; color?: string | null }): Promise<Tag>;
  updateTagRecord(
    tagId: string,
    input: { name?: string; color?: string | null },
  ): Promise<Tag>;
  deleteTag(tagId: string): Promise<void>;
}

/** Folders port (#361). */
export interface FoldersPort {
  subscribeFolderTree(
    onUpdate: (tree: FolderTreeNode[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): void;
  listFolderTree(): Promise<FolderTreeNode[]>;
  loadFolderTree(): Promise<FolderTreeNode[]>;
  createFolder(folderPath: string): Promise<string>;
  renameFolder(oldPath: string, newPath: string): Promise<string>;
  deleteFolder(folderPath: string): Promise<void>;
  moveItemToFolderPath(itemId: string, folderPath: string): Promise<ItemFile>;
}

/** Media / cover port (#361). */
export interface MediaPort {
  listItemMedia(itemId: string): Promise<MediaWithPath[]>;
  /**
   * @deprecated Absolute path resolution belongs on {@link UiSession.thumbnails} (#363).
   * Not part of the long-lived host transport contract (`Map` / abs paths).
   */
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  /**
   * @deprecated Absolute path batch belongs on {@link UiSession.thumbnails} (#363).
   * Not part of the long-lived host transport contract (`Map` / abs paths).
   */
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
  setItemCoverFromMedia(itemId: string, mediaId: string): Promise<ItemFile>;
  attachMediaFiles(
    itemId: string,
    files: AttachMediaFileInput[],
  ): Promise<MediaFileMeta[]>;
  replaceItemMedia(
    itemId: string,
    mediaId: string,
    file: AttachMediaFileInput,
  ): Promise<MediaFileMeta>;
  deleteItemMedia(itemId: string, mediaId: string): Promise<void>;
}

/** Vaults port (#361). */
export interface VaultsPort {
  listVaults(): Promise<VaultMeta[]>;
  getActiveVaultMeta(): Promise<VaultMeta>;
  switchVault(vaultId: string): Promise<VaultMeta>;
  setDefaultVault(vaultId: string): Promise<void>;
}

/** Index sync status port (#361). */
export interface IndexPort {
  subscribeVaultIndexSyncStatus(
    onUpdate: (status: VaultIndexSyncStatus) => void,
  ): () => void;
  getVaultIndexSyncStatus(): VaultIndexSyncStatus;
}

/** App settings persistence port (#361). */
export interface SettingsPort {
  ensureAppSettings(): Promise<AppSettings>;
  /**
   * @deprecated In-process sync read — use {@link UiSession.settingsSync} (#363).
   * External clients: async {@link SettingsPort.ensureAppSettings} + subscribe.
   */
  getAppSettingsSync(): AppSettings | null;
  updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  subscribeAppSettings(onUpdate: (settings: AppSettings) => void): () => void;
  getAppConfigDirectory(): Promise<string>;
}

/**
 * Dashboard snapshot cache — primary home is {@link UiSession.snapshot} (#363).
 * Still on the transitional flat {@link CollectorServiceApi}; not a
 * {@link CollectorService} key.
 */
export interface DashboardSnapshotPort {
  ensureDashboardSnapshot(): Promise<DashboardSnapshot | null>;
  peekMatchingDashboardSnapshot(input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    sort?: DashboardItemSort;
  }): DashboardSnapshot | null;
  persistDashboardSnapshot(snapshot: DashboardSnapshot): Promise<void>;
  clearDashboardSnapshot(): Promise<void>;
  buildDashboardSnapshot(input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    sort?: DashboardItemSort;
    itemIds: string[];
    items: DashboardSnapshot["items"];
    totalCount: number;
    streamEndOffset: number;
  }): DashboardSnapshot;
}

/**
 * Port-segmented sole-writer service contract (#361 / #360).
 * UI takes the composite (+ {@link UiSession} for UI-only slices); CLI/MCP take
 * only the ports they need.
 */
export interface CollectorService {
  boot: BootPort;
  items: ItemsPort;
  tags: TagsPort;
  folders: FoldersPort;
  media: MediaPort;
  vaults: VaultsPort;
  index: IndexPort;
  settings: SettingsPort;
}

/**
 * Full service API surface matching today's UI facade (`collector-service` +
 * settings/snapshot entrypoints the UI already uses).
 *
 * @deprecated Use {@link CollectorService} ports + {@link UiSession} for UI-only
 * slices (snapshot, sync settings getter, abs thumbnail paths). Transitional flat
 * facade (#145 → #360 / #363).
 */
export type CollectorServiceApi = BootPort &
  ItemsPort &
  TagsPort &
  FoldersPort &
  MediaPort &
  VaultsPort &
  IndexPort &
  SettingsPort &
  DashboardSnapshotPort;
