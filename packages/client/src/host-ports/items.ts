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
  SearchItemsResult,
  Subscription,
  UpdateItemInput,
} from "@collector/api";
import {
  asCollectorApiError,
  DASHBOARD_PREFETCH_SIZE,
  subscriptionFromTeardown,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";
import { bytesToBase64 } from "../bytes-to-base64.js";
import type { HostSessionCtx } from "../host-session-ctx.js";
import { hydrateHostItems } from "./items-hydrate.js";

/** Thin query/search RPC wrappers. */
function createItemsQueryMethods(
  transport: HostWireClient,
): Pick<ItemsPort, "searchItems" | "queryIndex"> {
  return {
    searchItems: async (
      query: string,
      filter: NavFilter,
      page?: { limit: number; offset: number },
    ): Promise<SearchItemsResult> =>
      transport.request("searchItems", {
        query,
        filter,
        ...(page === undefined ? {} : { page }),
      }) as Promise<SearchItemsResult>,
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
  };
}

/**
 * Dashboard index / load surfaces.
 * Hydrate + subscribe/stream keep local chunking and abort logic (#673).
 */
function createItemsDashboardMethods(
  transport: HostWireClient,
): Pick<
  ItemsPort,
  | "hydrate"
  | "fetchDashboardIndexPage"
  | "listDashboardItemIds"
  | "subscribeDashboardLoad"
  | "streamDashboardItems"
  | "loadDashboardItems"
> {
  return {
    hydrate: (ids, options) => hydrateHostItems(transport, ids, options),
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
  };
}

/** Single-item reads and link helpers. */
function createItemsReadMethods(
  transport: HostWireClient,
): Pick<
  ItemsPort,
  | "getItemById"
  | "getAdjacentItems"
  | "findSimilarItems"
  | "resolveContentTextLinks"
  | "listItemBacklinks"
  | "getItemSource"
> {
  return {
    getItemById: async (itemId: string): Promise<GetItemResult> =>
      transport.request("getItemById", { itemId }) as Promise<GetItemResult>,
    getAdjacentItems: async (itemId: string): Promise<AdjacentItemsResult> =>
      transport.request("getAdjacentItems", {
        itemId,
      }) as Promise<AdjacentItemsResult>,
    findSimilarItems: async (itemId: string, limit: number) =>
      transport.request("findSimilarItems", {
        itemId,
        limit,
      }) as ReturnType<ItemsPort["findSimilarItems"]>,
    resolveContentTextLinks: async (itemId: string, body: string) =>
      transport.request("resolveContentTextLinks", {
        itemId,
        body,
      }) as ReturnType<ItemsPort["resolveContentTextLinks"]>,
    listItemBacklinks: async (itemId: string) =>
      transport.request("listItemBacklinks", {
        itemId,
      }) as ReturnType<ItemsPort["listItemBacklinks"]>,
    getItemSource: async (itemId: string): Promise<string> =>
      transport.request("getItemSource", { itemId }) as Promise<string>,
  };
}

/** Create / update / delete / import wrappers. */
function createItemsWriteMethods(
  transport: HostWireClient,
): Pick<
  ItemsPort,
  | "updateItemSource"
  | "createItem"
  | "updateItem"
  | "deleteItem"
  | "importDroppedFiles"
> {
  return {
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
          dataBase64: bytesToBase64(file.bytes),
        })),
      }) as Promise<ImportDroppedFilesResult>,
  };
}

/**
 * Host items port: domain-grouped thin `transport.request` wrappers (#673).
 * Local logic lives only in hydrate / subscribe / stream helpers.
 */
export function createHostItemsPort(ctx: HostSessionCtx): ItemsPort {
  const { transport } = ctx;
  return {
    ...createItemsQueryMethods(transport),
    ...createItemsDashboardMethods(transport),
    ...createItemsReadMethods(transport),
    ...createItemsWriteMethods(transport),
  };
}
