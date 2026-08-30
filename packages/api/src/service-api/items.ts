import type { ItemFile, VaultMeta } from "@collector/shared";
import type {
  CreateItemInput,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
  ImportFolderInput,
  ImportFolderJobSnapshot,
  NavFilter,
  UpdateItemInput,
  WaitDerivedResult,
} from "../domain.js";
import type { DashboardLoadHandlers, Subscription } from "./shared.js";

/** Server-side dashboard ID list sort (#339). Keys must be allowlisted by the index. */
export type DashboardItemSortDir = "asc" | "desc";

export interface DashboardItemSort {
  key: string;
  dir: DashboardItemSortDir;
}

export interface DashboardIndexPage {
  itemIds: string[];
  /** Parallel to itemIds: index file_mtime_ms as string (#623). */
  stamps: string[];
  totalCount: number;
  offset: number;
}

/**
 * Canonical dashboard index page (#362). No Promise-in-DTO —
 * sync status lives on {@link IndexPort}.
 */
export interface IndexQueryResult {
  ids: string[];
  /** Parallel to ids: index file_mtime_ms as string (#623). */
  stamps: string[];
  total: number;
  offset: number;
}

/**
 * Paged FTS/nav search with honest total for truncation signaling (#658).
 * `items.length` may be less than `total` when the page is capped.
 */
export interface SearchItemsResult {
  items: ItemFile[];
  /** Total matching ids in the vault (not just this page). */
  total: number;
  offset: number;
}

/**
 * @deprecated Prefer {@link IndexQueryResult} via {@link ItemsPort.queryIndex}.
 * Index sync status lives on {@link IndexPort} (#163 / #362 / #364).
 */
export interface DashboardItemIdsResult {
  itemIds: string[];
  totalCount: number;
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

/** Semantic neighbor from item embeddings (#413). */
export interface SimilarItemHit {
  id: string;
  score: number;
}

/** Parsed text link from note body (#409). Mirrors core ResolvedTextLink. */
export interface ResolvedTextLink {
  kind: "wikilink" | "md";
  rawTarget: string;
  displayText: string | null;
  position: number;
  resolvedItemId: string | null;
  resolveStatus: "resolved" | "unresolved" | "ambiguous";
}

/** Outbound link scope for item footer panel (#457). */
export type OutboundLinkScope = "internal" | "external";

export type OutboundLinkStatus = "resolved" | "unresolved" | "ambiguous";

/** One outgoing text link from the current item body (#457). */
export interface OutboundTextLink {
  scope: OutboundLinkScope;
  kind: "wikilink" | "md";
  rawTarget: string;
  displayText: string | null;
  position: number;
  resolvedItemId: string | null;
  status: OutboundLinkStatus | null;
  title: string | null;
}

/** Unique item that links to a target note (#410). */
export interface BacklinkSource {
  id: string;
  title: string;
}

/** Neighbor connected by a user edge (#407). Same fields as {@link BacklinkSource}. */
export type UserEdgeNeighbor = BacklinkSource;

/** Items / search / dashboard loaders (#361 / #362). */
export interface ItemsPort {
  /**
   * FTS (or nav-list fallback) capped to a page; hydrates index card fields
   * only — not full on-disk markdown (#658). Returns `total` so callers can
   * surface truncation instead of silently cutting at {@link SEARCH_PAGE_SIZE}.
   */
  searchItems(
    query: string,
    filter: NavFilter,
    page?: { limit: number; offset: number },
  ): Promise<SearchItemsResult>;
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
  /** @deprecated Use {@link ItemsPort.queryIndex}. */
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
  ): Subscription;
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
  /** Top-k semantic neighbors from item embeddings (#413). */
  findSimilarItems(itemId: string, limit: number): Promise<SimilarItemHit[]>;
  /** Resolve `[[wikilink]]` / vault md links in a note body (#409). */
  resolveContentTextLinks(
    itemId: string,
    body: string,
  ): Promise<ResolvedTextLink[]>;
  /** Unique notes that link to this item via text links (#410). */
  listItemBacklinks(itemId: string): Promise<BacklinkSource[]>;
  /** Outgoing text links from the current item body (#457). */
  listItemOutboundLinks(itemId: string): Promise<OutboundTextLink[]>;
  /** Undirected user edges for one item (#407). */
  addUserEdge(itemId: string, otherItemId: string): Promise<void>;
  removeUserEdge(itemId: string, otherItemId: string): Promise<void>;
  listUserEdges(itemId: string): Promise<UserEdgeNeighbor[]>;
  getItemSource(itemId: string): Promise<string>;
  updateItemSource(itemId: string, rawMarkdown: string): Promise<ItemFile>;
  createItem(input: CreateItemInput): Promise<ItemFile>;
  updateItem(itemId: string, input: UpdateItemInput): Promise<ItemFile>;
  deleteItem(itemId: string): Promise<void>;
  importDroppedFiles(
    input: ImportDroppedFilesInput,
  ): Promise<ImportDroppedFilesResult>;
  /**
   * Enqueue host-path folder import and return immediately (#747).
   * Poll {@link ItemsPort.getImportFolderJob} for status/result.
   */
  importFolder(input: ImportFolderInput): Promise<{ jobId: string }>;
  /** Snapshot of an {@link ItemsPort.importFolder} job (#747). */
  getImportFolderJob(jobId: string): Promise<ImportFolderJobSnapshot>;
  /**
   * Opt-in await of `itemDerivedRefresh` for one item revision (#770 / #765).
   * For scripts/agents that must chain on fully caught-up derived state.
   * **Not** for ordinary UI save or bulk loops — default mutate stays
   * fire-and-forget for derived work.
   */
  waitDerived(
    itemId: string,
    contentRevision: number,
    options?: { timeoutMs?: number },
  ): Promise<WaitDerivedResult>;
}
