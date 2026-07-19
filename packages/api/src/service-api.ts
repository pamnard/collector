import type { ItemFile, VaultMeta } from "@collector/shared";
import type {
  AttachMediaFileInput,
  CreateItemInput,
  FolderTreeNode,
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
 * Note: `indexSync` is a Promise in the in-process facade today.
 * Over IPC this will likely become a separate subscribe/status channel (#163).
 */
export interface DashboardItemIdsResult {
  itemIds: string[];
  totalCount: number;
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

export interface DashboardLoadHandlers {
  onIndexPage: (page: DashboardIndexPage) => void;
  getLoadedIdCount?: () => number;
  onLoadComplete?: () => void;
  onError?: (scope: string, error: unknown) => void;
}

export interface ServiceSubscribeHandlers {
  onError?: (scope: string, error: unknown) => void;
}

/**
 * Full service API surface matching today's UI facade (`collector-service` +
 * settings/snapshot entrypoints the UI already uses).
 * Methods are the contract; implementations come later (LocalAdapter / IPC).
 */
export interface CollectorServiceApi {
  // Boot / DB
  openCollectorDatabase(): Promise<void>;
  ensureCollectorDatabaseHealthy(): Promise<void>;
  ensureActiveVault(): Promise<ActiveVaultResult>;
  getDataDirectory(): Promise<string>;

  // Items / search / dashboard
  listItems(): Promise<ItemFile[]>;
  searchItems(query: string, filter: NavFilter): Promise<ItemFile[]>;
  fetchDashboardIndexPage(
    filter: NavFilter,
    query: string | undefined,
    page: { limit: number; offset: number },
  ): Promise<DashboardIndexPage>;
  listDashboardItemIds(
    filter: NavFilter,
    query?: string,
  ): Promise<DashboardItemIdsResult>;
  subscribeDashboardLoad(
    filter: NavFilter,
    query: string,
    handlers: DashboardLoadHandlers,
    signal?: AbortSignal,
  ): void;
  streamDashboardItems(
    itemIds: string[],
    offset: number,
    limit: number,
    onItem: (item: ItemFile) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  loadDashboardItems(
    itemIds: string[],
    offset: number,
    limit?: number,
  ): Promise<ItemFile[]>;
  getItemById(itemId: string): Promise<GetItemResult>;
  getItemSource(itemId: string): Promise<string>;
  updateItemSource(itemId: string, rawMarkdown: string): Promise<ItemFile>;
  createItem(input: CreateItemInput): Promise<ItemFile>;
  updateItem(itemId: string, input: UpdateItemInput): Promise<ItemFile>;
  deleteItem(itemId: string): Promise<void>;

  // Tags
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

  // Folders
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

  // Media / cover
  listItemMedia(itemId: string): Promise<MediaWithPath[]>;
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
  setItemCoverFromMedia(itemId: string, mediaId: string): Promise<ItemFile>;
  attachMediaFiles(
    itemId: string,
    files: AttachMediaFileInput[],
  ): Promise<MediaFileMeta[]>;
  deleteItemMedia(itemId: string, mediaId: string): Promise<void>;

  // Vaults
  listVaults(): Promise<VaultMeta[]>;
  getActiveVaultMeta(): Promise<VaultMeta>;
  switchVault(vaultId: string): Promise<VaultMeta>;
  setDefaultVault(vaultId: string): Promise<void>;

  // Sync / status
  subscribeVaultIndexSyncStatus(
    onUpdate: (status: VaultIndexSyncStatus) => void,
  ): () => void;
  getVaultIndexSyncStatus(): VaultIndexSyncStatus;

  // Settings (UI facade beside collector-service)
  ensureAppSettings(): Promise<AppSettings>;
  getAppSettingsSync(): AppSettings | null;
  updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  subscribeAppSettings(onUpdate: (settings: AppSettings) => void): () => void;
  getAppConfigDirectory(): Promise<string>;

  // Dashboard snapshot
  ensureDashboardSnapshot(): Promise<DashboardSnapshot | null>;
  peekMatchingDashboardSnapshot(input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
  }): DashboardSnapshot | null;
  persistDashboardSnapshot(snapshot: DashboardSnapshot): Promise<void>;
  clearDashboardSnapshot(): Promise<void>;
  buildDashboardSnapshot(input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    itemIds: string[];
    items: DashboardSnapshot["items"];
    totalCount: number;
    streamEndOffset: number;
  }): DashboardSnapshot;
}
