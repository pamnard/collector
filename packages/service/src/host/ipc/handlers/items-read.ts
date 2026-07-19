/**
 * IPC handlers: item/search/dashboard reads (#155).
 */

import type { NavFilter } from "@collector/api";
import { serviceIpcError } from "../errors.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

function badRequest(message: string): never {
  throw serviceIpcError({
    layer: "validation",
    code: "bad_request",
    message,
  });
}

function asObject(params: unknown, method: string): Record<string, unknown> {
  if (params === undefined || params === null) {
    return {};
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    badRequest(`${method}: params must be an object`);
  }
  return params as Record<string, unknown>;
}

function requireString(
  value: unknown,
  field: string,
  method: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    badRequest(`${method}: ${field} must be a non-empty string`);
  }
  return value;
}

function parseNavFilter(value: unknown, method: string): NavFilter {
  if (value === "all") {
    return "all";
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.type === "tag" && typeof obj.tagId === "string") {
      return { type: "tag", tagId: obj.tagId };
    }
    if (obj.type === "folder" && typeof obj.folderPath === "string") {
      return { type: "folder", folderPath: obj.folderPath };
    }
  }
  badRequest(`${method}: invalid NavFilter`);
}

export function buildItemsReadHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { itemsSearch } = runtime;
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.listItems]: async () => {
      await runtime.ensureInitialized();
      return itemsSearch.listItems();
    },
    [M.searchItems]: async (params) => {
      const p = asObject(params, M.searchItems);
      const query = requireString(p.query, "query", M.searchItems);
      const filter = parseNavFilter(p.filter, M.searchItems);
      await runtime.ensureInitialized();
      return itemsSearch.searchItems(query, filter);
    },
    [M.fetchDashboardIndexPage]: async (params) => {
      const p = asObject(params, M.fetchDashboardIndexPage);
      const filter = parseNavFilter(p.filter, M.fetchDashboardIndexPage);
      const query = typeof p.query === "string" ? p.query : undefined;
      if (!p.page || typeof p.page !== "object" || Array.isArray(p.page)) {
        badRequest(`${M.fetchDashboardIndexPage}: page required`);
      }
      const page = p.page as Record<string, unknown>;
      if (typeof page.limit !== "number" || typeof page.offset !== "number") {
        badRequest(`${M.fetchDashboardIndexPage}: page.limit/offset required`);
      }
      await runtime.ensureInitialized();
      return itemsSearch.fetchDashboardIndexPage(filter, query, {
        limit: page.limit,
        offset: page.offset,
      });
    },
    [M.listDashboardItemIds]: async (params) => {
      const p = asObject(params, M.listDashboardItemIds);
      const filter = parseNavFilter(p.filter, M.listDashboardItemIds);
      const query = typeof p.query === "string" ? p.query : undefined;
      await runtime.ensureInitialized();
      const result = await itemsSearch.listDashboardItemIds(filter, query);
      return { itemIds: result.itemIds, totalCount: result.totalCount };
    },
    [M.loadDashboardItems]: async (params) => {
      const p = asObject(params, M.loadDashboardItems);
      if (
        !Array.isArray(p.itemIds) ||
        !p.itemIds.every((id) => typeof id === "string")
      ) {
        badRequest(`${M.loadDashboardItems}: itemIds must be string[]`);
      }
      if (typeof p.offset !== "number") {
        badRequest(`${M.loadDashboardItems}: offset must be a number`);
      }
      const limit = typeof p.limit === "number" ? p.limit : undefined;
      await runtime.ensureInitialized();
      return itemsSearch.loadDashboardItems(p.itemIds, p.offset, limit);
    },
    [M.getItemById]: async (params) => {
      const p = asObject(params, M.getItemById);
      const itemId = requireString(p.itemId, "itemId", M.getItemById);
      await runtime.ensureInitialized();
      return itemsSearch.getItemById(itemId);
    },
    [M.getItemSource]: async (params) => {
      const p = asObject(params, M.getItemSource);
      const itemId = requireString(p.itemId, "itemId", M.getItemSource);
      await runtime.ensureInitialized();
      return itemsSearch.getItemSource(itemId);
    },
  };
}
