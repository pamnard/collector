import type {
  AdjacentItemsResult,
  CreateItemInput,
  DashboardIndexPage,
  DashboardItemIdsResult,
  DashboardItemSort,
  DashboardLoadHandlers,
  GetItemResult,
  ImportDroppedFilesInput,
  ImportDroppedFilesResult,
  IndexQueryResult,
  ItemsPort,
  NavFilter,
  Subscription,
  UpdateItemInput,
} from "@collector/api";
import {
  asCollectorApiError,
  DASHBOARD_PREFETCH_SIZE,
  subscriptionFromTeardown,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcItemsPort(ctx: IpcSessionCtx): ItemsPort {
  const { transport } = ctx;
  return {
    searchItems: async (
      query: string,
      filter: NavFilter,
    ): Promise<ItemFile[]> =>
      transport.request("searchItems", {
        query,
        filter,
      }) as Promise<ItemFile[]>,
    queryIndex: async (
      filter: NavFilter,
      query: string | undefined,
      page: { limit: number; offset: number },
      sort?: DashboardItemSort,
    ): Promise<IndexQueryResult> =>
      transport.request("queryIndex", {
        filter,
        query,
        page,
        sort,
      }) as Promise<IndexQueryResult>,
    async *hydrate(
      ids: string[],
      options?: { signal?: AbortSignal },
    ): AsyncIterable<ItemFile> {
      if (!ids.length || options?.signal?.aborted) {
        return;
      }
      const items = (await transport.request("loadDashboardItems", {
        itemIds: ids,
        offset: 0,
        limit: ids.length,
      })) as ItemFile[];
      for (const item of items) {
        if (options?.signal?.aborted) {
          return;
        }
        yield item;
      }
    },
    fetchDashboardIndexPage: async (
      filter: NavFilter,
      query: string | undefined,
      page: { limit: number; offset: number },
      sort?: DashboardItemSort,
    ): Promise<DashboardIndexPage> =>
      transport.request("fetchDashboardIndexPage", {
        filter,
        query,
        page,
        sort,
      }) as Promise<DashboardIndexPage>,
    listDashboardItemIds: async (
      filter: NavFilter,
      query?: string,
      sort?: DashboardItemSort,
    ): Promise<DashboardItemIdsResult> =>
      transport.request("listDashboardItemIds", {
        filter,
        query,
        sort,
      }) as Promise<DashboardItemIdsResult>,
    subscribeDashboardLoad(
      filter: NavFilter,
      query: string,
      handlers: DashboardLoadHandlers,
      signal?: AbortSignal,
      sort?: DashboardItemSort,
    ): Subscription {
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", () => controller.abort(), {
            once: true,
          });
        }
      }
      const active = controller.signal;
      void (async () => {
        try {
          if (active.aborted) {
            return;
          }
          const page = (await transport.request("fetchDashboardIndexPage", {
            filter,
            query,
            page: { limit: DASHBOARD_PREFETCH_SIZE, offset: 0 },
            sort,
          })) as DashboardIndexPage;
          if (active.aborted) {
            return;
          }
          handlers.onIndexPage(page);
          handlers.onLoadComplete?.();
        } catch (error: unknown) {
          if (!active.aborted) {
            handlers.onError?.("dashboard load", asCollectorApiError(error));
          }
        }
      })();
      return subscriptionFromTeardown(() => controller.abort());
    },
    streamDashboardItems: async (
      itemIds: string[],
      offset: number,
      limit: number,
      onItem: (item: ItemFile) => void,
      signal?: AbortSignal,
    ): Promise<void> => {
      const items = (await transport.request("loadDashboardItems", {
        itemIds,
        offset,
        limit,
      })) as ItemFile[];
      for (const item of items) {
        if (signal?.aborted) {
          return;
        }
        onItem(item);
      }
    },
    loadDashboardItems: async (
      itemIds: string[],
      offset: number,
      limit?: number,
    ): Promise<ItemFile[]> =>
      transport.request("loadDashboardItems", {
        itemIds,
        offset,
        limit,
      }) as Promise<ItemFile[]>,
    getItemById: async (itemId: string): Promise<GetItemResult> =>
      transport.request("getItemById", { itemId }) as Promise<GetItemResult>,
    getAdjacentItems: async (itemId: string): Promise<AdjacentItemsResult> =>
      transport.request("getAdjacentItems", {
        itemId,
      }) as Promise<AdjacentItemsResult>,
    getItemSource: async (itemId: string): Promise<string> =>
      transport.request("getItemSource", { itemId }) as Promise<string>,
    updateItemSource: async (
      itemId: string,
      rawMarkdown: string,
    ): Promise<ItemFile> =>
      transport.request("updateItemSource", {
        itemId,
        rawMarkdown,
      }) as Promise<ItemFile>,
    createItem: async (input: CreateItemInput): Promise<ItemFile> =>
      transport.request(
        "createItem",
        input as unknown as Record<string, unknown>,
      ) as Promise<ItemFile>,
    updateItem: async (
      itemId: string,
      input: UpdateItemInput,
    ): Promise<ItemFile> =>
      transport.request("updateItem", {
        itemId,
        input,
      }) as Promise<ItemFile>,
    deleteItem: async (itemId: string): Promise<void> => {
      await transport.request("deleteItem", { itemId });
    },
    importDroppedFiles: async (
      input: ImportDroppedFilesInput,
    ): Promise<ImportDroppedFilesResult> =>
      transport.request("importDroppedFiles", {
        folder_path: input.folder_path,
        files: input.files.map((file) => ({
          relativePath: file.relativePath,
          filename: file.name,
          dataBase64: Buffer.from(file.bytes).toString("base64"),
        })),
      }) as Promise<ImportDroppedFilesResult>,
  };
}
