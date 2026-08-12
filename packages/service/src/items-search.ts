/**
 * In-process items / search / dashboard list ops (#147).
 * Host injects vault/index accessors; no Tauri / host-wire here.
 */

import {
  DASHBOARD_PREFETCH_SIZE,
  type AdjacentItemsResult,
  type CreateItemInput,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type DashboardItemSort,
  type DashboardLoadHandlers,
  type GetItemResult,
  type IndexQueryResult,
  type NavFilter,
  type ResolvedTextLink,
  type SimilarItemHit,
  type Subscription,
  type UpdateItemInput,
} from "@collector/api";
import type { ItemFile, VaultMeta } from "@collector/shared";
import {
  listItemsByIds,
  type AdjacentItemAnchor,
  type IndexSyncProgress,
  type VaultContext,
} from "@collector/core";
import {
  assertDashboardItemSort,
  queryDashboardIndexPage,
} from "./dashboard-index-page.js";
import { createItemsCrud } from "./items-crud.js";
import { subscribeDashboardLoad as subscribeDashboardLoadImpl } from "./items-dashboard-subscribe.js";

export { DASHBOARD_PREFETCH_SIZE };
export type { DashboardIndexPage, DashboardItemIdsResult, DashboardItemSort };
export {
  assertDashboardItemSort,
  queryDashboardIndexPage,
} from "./dashboard-index-page.js";

export interface ItemsIndexPort {
  listItemIdsByNavFilter(
    vaultId: string,
    filter: NavFilter,
    page?: { limit: number; offset: number; sort?: DashboardItemSort },
  ): Promise<string[]>;
  countItemIdsByNavFilter(vaultId: string, filter: NavFilter): Promise<number>;
  searchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavFilter,
    page?: { limit: number; offset: number },
  ): Promise<string[]>;
  countSearchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavFilter,
  ): Promise<number>;
  listItemFilesByIds(vaultId: string, itemIds: string[]): Promise<ItemFile[]>;
  listItemPresentationStampsByIds(
    vaultId: string,
    itemIds: string[],
  ): Promise<string[]>;
  /** Light id/title rows for text-link resolve (#409); avoid full ItemFile load. */
  listItemIdTitles(
    vaultId: string,
  ): Promise<Array<{ id: string; title: string }>>;
  getAdjacentItems(
    vaultId: string,
    anchor: AdjacentItemAnchor,
  ): Promise<AdjacentItemsResult>;
}

export type VaultSyncBatchListener = {
  onBatch?: (progress: IndexSyncProgress) => void;
  onComplete?: () => void;
};

export interface ItemsSearchServiceDeps {
  resolveActiveVault: () => Promise<{ vault: VaultMeta; path: string }>;
  getContext: () => VaultContext;
  getIndex: () => ItemsIndexPort;
  kickoffVaultIndexSync: (vaultId: string, vaultPath: string) => void;
  startVaultIndexSync: (vaultId: string, vaultPath: string) => Promise<void>;
  buildSearchFtsQuery: (userQuery: string, vaultId: string) => string | null;
  addVaultSyncListener: (
    vaultId: string,
    listener: VaultSyncBatchListener,
  ) => () => void;
  /** Optional UI cache hook after delete. */
  onItemDeleted?: (itemId: string) => void;
  /** After successful item create/update/delete/source write (#623). */
  onVaultPresentationChanged?: (vaultId: string) => void;
  createItemId?: () => string;
  syncRepublishThrottleMs?: number;
  findSimilarItems: (
    itemId: string,
    limit: number,
  ) => Promise<SimilarItemHit[]>;
}

export interface ItemsSearchService {
  searchItems(query: string, filter: NavFilter): Promise<ItemFile[]>;
  queryIndex(
    filter: NavFilter,
    query: string | undefined,
    page: { limit: number; offset: number },
    sort?: DashboardItemSort,
  ): Promise<IndexQueryResult>;
  hydrate(
    ids: string[],
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ItemFile>;
  fetchDashboardIndexPage(
    filter: NavFilter,
    query: string | undefined,
    page: { limit: number; offset: number },
    sort?: DashboardItemSort,
  ): Promise<DashboardIndexPage>;
  listDashboardItemIds(
    filter: NavFilter,
    query?: string,
    sort?: DashboardItemSort,
  ): Promise<DashboardItemIdsResult>;
  subscribeDashboardLoad(
    filter: NavFilter,
    query: string,
    handlers: DashboardLoadHandlers,
    signal?: AbortSignal,
    sort?: DashboardItemSort,
  ): Subscription;
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
  getAdjacentItems(itemId: string): Promise<AdjacentItemsResult>;
  findSimilarItems(
    itemId: string,
    limit: number,
  ): Promise<SimilarItemHit[]>;
  resolveContentTextLinks(
    itemId: string,
    body: string,
  ): Promise<ResolvedTextLink[]>;
  getItemSource(itemId: string): Promise<string>;
  updateItemSource(itemId: string, rawMarkdown: string): Promise<ItemFile>;
  createItem(input: CreateItemInput): Promise<ItemFile>;
  updateItem(itemId: string, input: UpdateItemInput): Promise<ItemFile>;
  deleteItem(itemId: string): Promise<void>;
}

export function createItemsSearchService(
  deps: ItemsSearchServiceDeps,
): ItemsSearchService {
  const republishMs = deps.syncRepublishThrottleMs ?? 500;
  const newItemId = deps.createItemId ?? (() => crypto.randomUUID());
  const crud = createItemsCrud(deps, newItemId);

  const searchItems = async (
    query: string,
    filter: NavFilter,
  ): Promise<ItemFile[]> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);

    const ftsQuery = deps.buildSearchFtsQuery(query, vault.id);
    if (!ftsQuery) {
      const itemIds = await deps
        .getIndex()
        .listItemIdsByNavFilter(vault.id, filter);
      return listItemsByIds(deps.getContext(), path, itemIds);
    }

    const itemIds = await deps
      .getIndex()
      .searchItemIds(vault.id, ftsQuery, filter);
    return listItemsByIds(deps.getContext(), path, itemIds);
  };

  const fetchDashboardIndexPage = async (
    filter: NavFilter,
    query = "",
    page: { limit: number; offset: number },
    sort?: DashboardItemSort,
  ): Promise<DashboardIndexPage> => {
    const { vault } = await deps.resolveActiveVault();
    return queryDashboardIndexPage(
      deps.getIndex(),
      deps.buildSearchFtsQuery,
      vault.id,
      filter,
      query,
      page,
      assertDashboardItemSort(sort),
    );
  };

  const queryIndex = async (
    filter: NavFilter,
    query: string | undefined,
    page: { limit: number; offset: number },
    sort?: DashboardItemSort,
  ): Promise<IndexQueryResult> => {
    // Dashboard protocol sole entry (#367): start sync without subscribeDashboardLoad.
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    const result = await fetchDashboardIndexPage(filter, query, page, sort);
    return {
      ids: result.itemIds,
      stamps: result.stamps,
      total: result.totalCount,
      offset: result.offset,
    };
  };

  const listDashboardItemIds = async (
    filter: NavFilter,
    query = "",
    sort?: DashboardItemSort,
  ): Promise<DashboardItemIdsResult> => {
    const page = await fetchDashboardIndexPage(
      filter,
      query,
      {
        limit: DASHBOARD_PREFETCH_SIZE,
        offset: 0,
      },
      sort,
    );
    const { vault, path } = await deps.resolveActiveVault();
    // Kick sync as side effect; status via IndexPort subscribe (#163 / #364).
    void deps.startVaultIndexSync(vault.id, path).catch((error: unknown) => {
      console.error("[collector] index sync failed:", error);
    });
    return { itemIds: page.itemIds, totalCount: page.totalCount };
  };

  const streamDashboardItems = async (
    itemIds: string[],
    offset: number,
    limit: number,
    onItem: (item: ItemFile) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (!itemIds.length || offset >= itemIds.length || limit <= 0) {
      return;
    }
    if (signal?.aborted) {
      return;
    }

    const { vault } = await deps.resolveActiveVault();
    if (signal?.aborted) {
      return;
    }

    const batchIds = itemIds.slice(offset, offset + limit);
    const items = await deps.getIndex().listItemFilesByIds(vault.id, batchIds);

    for (const item of items) {
      if (signal?.aborted) {
        return;
      }
      onItem(item);
    }
  };

  const loadDashboardItems = async (
    itemIds: string[],
    offset: number,
    limit = DASHBOARD_PREFETCH_SIZE,
  ): Promise<ItemFile[]> => {
    if (!itemIds.length || offset >= itemIds.length) {
      return [];
    }

    const items: ItemFile[] = [];
    await streamDashboardItems(itemIds, offset, limit, (item) => {
      items.push(item);
    });
    return items;
  };

  async function* hydrate(
    ids: string[],
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ItemFile> {
    if (!ids.length || options?.signal?.aborted) {
      return;
    }
    const { vault } = await deps.resolveActiveVault();
    if (options?.signal?.aborted) {
      return;
    }
    const items = await deps.getIndex().listItemFilesByIds(vault.id, ids);
    for (const item of items) {
      if (options?.signal?.aborted) {
        return;
      }
      yield item;
    }
  }

  return {
    searchItems,
    queryIndex,
    hydrate,
    fetchDashboardIndexPage,
    listDashboardItemIds,
    subscribeDashboardLoad: (filter, query, handlers, signal, sort) =>
      subscribeDashboardLoadImpl(
        deps,
        republishMs,
        filter,
        query,
        handlers,
        signal,
        sort,
      ),
    streamDashboardItems,
    loadDashboardItems,
    getItemById: crud.getItemById,
    getAdjacentItems: crud.getAdjacentItems,
    findSimilarItems: deps.findSimilarItems,
    resolveContentTextLinks: crud.resolveContentTextLinks,
    getItemSource: crud.getItemSource,
    updateItemSource: crud.updateItemSource,
    createItem: crud.createItem,
    updateItem: crud.updateItem,
    deleteItem: crud.deleteItem,
  };
}
