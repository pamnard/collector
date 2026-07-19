/**
 * In-process items / search / dashboard list ops (#147).
 * Host injects vault/index accessors; no Tauri / IPC here.
 */

import {
  DASHBOARD_PREFETCH_SIZE,
  type CreateItemInput,
  type DashboardIndexPage,
  type DashboardItemIdsResult,
  type DashboardLoadHandlers,
  type GetItemResult,
  type NavFilter,
  type UpdateItemInput,
} from "@collector/api";
import type { ItemFile, VaultMeta } from "@collector/shared";
import {
  createFolder as createFolderOnVault,
  deleteItem as deleteItemOnDisk,
  itemMarkdownPath,
  listItemsByIds,
  listItemsOnDisk,
  moveItemToFolder,
  readItemContent,
  readItemFile,
  readItemRawMarkdown,
  upsertItem,
  writeItemRawMarkdown,
  type IndexSyncProgress,
  type VaultContext,
} from "@collector/core";

export { DASHBOARD_PREFETCH_SIZE };
export type { DashboardIndexPage, DashboardItemIdsResult };

export interface ItemsIndexPort {
  listItemIdsByNavFilter(
    vaultId: string,
    filter: NavFilter,
    page?: { limit: number; offset: number },
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
  createItemId?: () => string;
  syncRepublishThrottleMs?: number;
}

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

export async function queryDashboardIndexPage(
  index: ItemsIndexPort,
  buildSearchFtsQuery: (userQuery: string, vaultId: string) => string | null,
  vaultId: string,
  filter: NavFilter,
  query: string,
  page: { limit: number; offset: number },
): Promise<DashboardIndexPage> {
  const trimmedSearch = query.trim();

  if (!trimmedSearch) {
    const [itemIds, totalCount] = await Promise.all([
      index.listItemIdsByNavFilter(vaultId, filter, page),
      index.countItemIdsByNavFilter(vaultId, filter),
    ]);
    return { itemIds, totalCount, offset: page.offset };
  }

  const ftsQuery = buildSearchFtsQuery(trimmedSearch, vaultId);
  if (!ftsQuery) {
    const [itemIds, totalCount] = await Promise.all([
      index.listItemIdsByNavFilter(vaultId, filter, page),
      index.countItemIdsByNavFilter(vaultId, filter),
    ]);
    return { itemIds, totalCount, offset: page.offset };
  }

  const [itemIds, totalCount] = await Promise.all([
    index.searchItemIds(vaultId, ftsQuery, filter, page),
    index.countSearchItemIds(vaultId, ftsQuery, filter),
  ]);
  return { itemIds, totalCount, offset: page.offset };
}

export interface ItemsSearchService {
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
}

export function createItemsSearchService(
  deps: ItemsSearchServiceDeps,
): ItemsSearchService {
  const republishMs = deps.syncRepublishThrottleMs ?? 500;
  const newItemId = deps.createItemId ?? (() => crypto.randomUUID());

  const listItems = async (): Promise<ItemFile[]> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return listItemsOnDisk(deps.getContext(), path);
  };

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
  ): Promise<DashboardIndexPage> => {
    const { vault } = await deps.resolveActiveVault();
    return queryDashboardIndexPage(
      deps.getIndex(),
      deps.buildSearchFtsQuery,
      vault.id,
      filter,
      query,
      page,
    );
  };

  const listDashboardItemIds = async (
    filter: NavFilter,
    query = "",
  ): Promise<DashboardItemIdsResult> => {
    const page = await fetchDashboardIndexPage(filter, query, {
      limit: DASHBOARD_PREFETCH_SIZE,
      offset: 0,
    });
    const { vault, path } = await deps.resolveActiveVault();
    const indexSync = deps.startVaultIndexSync(vault.id, path);
    return { itemIds: page.itemIds, totalCount: page.totalCount, indexSync };
  };

  const subscribeDashboardLoad = (
    filter: NavFilter,
    query: string,
    handlers: DashboardLoadHandlers,
    signal?: AbortSignal,
  ): void => {
    void (async () => {
      const { vault, path } = await deps.resolveActiveVault();
      if (signal?.aborted) {
        return;
      }

      const publishPage = async (pageRequest: {
        limit: number;
        offset: number;
      }) => {
        try {
          const page = await queryDashboardIndexPage(
            deps.getIndex(),
            deps.buildSearchFtsQuery,
            vault.id,
            filter,
            query,
            pageRequest,
          );
          if (!signal?.aborted) {
            handlers.onIndexPage(page);
          }
        } catch (error: unknown) {
          handlers.onError?.("dashboard index page", error);
          if (!signal?.aborted) {
            handlers.onIndexPage({ itemIds: [], totalCount: 0, offset: 0 });
          }
        }
      };

      const republish = createThrottledPublisher(() => {
        const loaded = handlers.getLoadedIdCount?.() ?? DASHBOARD_PREFETCH_SIZE;
        void publishPage({
          offset: 0,
          limit: Math.max(loaded, DASHBOARD_PREFETCH_SIZE),
        });
      }, republishMs);

      const unsub = deps.addVaultSyncListener(vault.id, {
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

      deps.kickoffVaultIndexSync(vault.id, path);

      await publishPage({ offset: 0, limit: DASHBOARD_PREFETCH_SIZE });
      if (!signal?.aborted) {
        handlers.onLoadComplete?.();
      }
    })().catch((error: unknown) => {
      handlers.onError?.("dashboard load", error);
    });
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

  const getItemById = async (itemId: string): Promise<GetItemResult> => {
    const { path, vault } = await deps.resolveActiveVault();
    const ctx = deps.getContext();

    if (!(await ctx.fs.exists(itemMarkdownPath(path, itemId)))) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const item = await readItemFile(ctx.fs, path, itemId, vault.id);
    const content = await readItemContent(ctx.fs, path, itemId);
    return { item, content };
  };

  const getItemSource = async (itemId: string): Promise<string> => {
    const { path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    if (!(await ctx.fs.exists(itemMarkdownPath(path, itemId)))) {
      throw new Error(`Item not found: ${itemId}`);
    }
    return readItemRawMarkdown(ctx.fs, path, itemId);
  };

  const updateItemSource = async (
    itemId: string,
    rawMarkdown: string,
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    return writeItemRawMarkdown(
      deps.getContext(),
      path,
      vault.id,
      itemId,
      rawMarkdown,
    );
  };

  const createItem = async (input: CreateItemInput): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const timestamp = new Date().toISOString();
    const folderPath = input.folder_path?.trim() ?? "";
    const fileName = `${newItemId()}.md`;
    const id = folderPath ? `${folderPath}/${fileName}` : fileName;

    if (folderPath) {
      await createFolderOnVault(ctx, path, folderPath);
    }

    return upsertItem(ctx, path, vault.id, {
      item: {
        id,
        vault_id: vault.id,
        title: input.title,
        description: input.description ?? "",
        url: input.url ?? null,
        content_type: input.content_type,
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: input.content ?? null,
    });
  };

  const updateItem = async (
    itemId: string,
    input: UpdateItemInput,
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    const { item: existing, content: existingContent } =
      await getItemById(itemId);
    const ctx = deps.getContext();

    let current = existing;
    let currentContent = existingContent;
    if (
      input.folder_path !== undefined &&
      input.folder_path !== existing.folder_path
    ) {
      current = await moveItemToFolder(
        ctx,
        path,
        vault.id,
        existing.id,
        input.folder_path,
      );
      currentContent = await readItemContent(ctx.fs, path, current.id);
    }

    return upsertItem(ctx, path, vault.id, {
      item: {
        ...current,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        url: input.url !== undefined ? input.url : current.url,
        content_type: input.content_type ?? current.content_type,
        tag_ids: input.tag_ids ?? current.tag_ids,
      },
      content: input.content !== undefined ? input.content : currentContent,
    });
  };

  const deleteItem = async (itemId: string): Promise<void> => {
    const { path } = await deps.resolveActiveVault();
    await deleteItemOnDisk(deps.getContext(), path, itemId);
    deps.onItemDeleted?.(itemId);
  };

  return {
    listItems,
    searchItems,
    fetchDashboardIndexPage,
    listDashboardItemIds,
    subscribeDashboardLoad,
    streamDashboardItems,
    loadDashboardItems,
    getItemById,
    getItemSource,
    updateItemSource,
    createItem,
    updateItem,
    deleteItem,
  };
}
