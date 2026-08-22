import type { CreateItemInput, UpdateItemInput } from "@collector/api";
import { searchItemsPageViolation } from "@collector/api";
import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import {
  asObject,
  badRequest,
  parseDashboardItemSort,
  parseNavFilter,
  requireString,
} from "../handlers/params.js";
import { decodeDroppedFiles } from "./decode.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const ITEMS_DISPATCH = {
  [M.searchItems]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.searchItems);
      const query = requireString(p.query, "query", M.searchItems);
      const filter = parseNavFilter(p.filter, M.searchItems);
      let page: { limit: number; offset: number } | undefined;
      if (p.page !== undefined) {
        if (!p.page || typeof p.page !== "object" || Array.isArray(p.page)) {
          badRequest(`${M.searchItems}: page must be an object`);
        }
        const raw = p.page as Record<string, unknown>;
        if (typeof raw.limit !== "number" || !Number.isFinite(raw.limit)) {
          badRequest(`${M.searchItems}: page.limit must be a number`);
        }
        if (typeof raw.offset !== "number" || !Number.isFinite(raw.offset)) {
          badRequest(`${M.searchItems}: page.offset must be a number`);
        }
        page = { limit: raw.limit, offset: raw.offset };
        const violation = searchItemsPageViolation(page);
        if (violation !== null) {
          badRequest(`${M.searchItems}: ${violation}`);
        }
      }
      await runtime.ensureInitialized();
      return runtime.itemsSearch.searchItems(query, filter, page);
    },
  },
  [M.fetchDashboardIndexPage]: {
    handle: async (runtime, params) => {
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
      const sort = parseDashboardItemSort(p.sort, M.fetchDashboardIndexPage);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.fetchDashboardIndexPage(
        filter,
        query,
        { limit: page.limit, offset: page.offset },
        sort,
      );
    },
  },
  [M.queryIndex]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.queryIndex);
      const filter = parseNavFilter(p.filter, M.queryIndex);
      const query = typeof p.query === "string" ? p.query : undefined;
      if (!p.page || typeof p.page !== "object" || Array.isArray(p.page)) {
        badRequest(`${M.queryIndex}: page required`);
      }
      const page = p.page as Record<string, unknown>;
      if (typeof page.limit !== "number" || typeof page.offset !== "number") {
        badRequest(`${M.queryIndex}: page.limit/offset required`);
      }
      const sort = parseDashboardItemSort(p.sort, M.queryIndex);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.queryIndex(
        filter,
        query,
        { limit: page.limit, offset: page.offset },
        sort,
      );
    },
  },
  [M.listDashboardItemIds]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.listDashboardItemIds);
      const filter = parseNavFilter(p.filter, M.listDashboardItemIds);
      const query = typeof p.query === "string" ? p.query : undefined;
      const sort = parseDashboardItemSort(p.sort, M.listDashboardItemIds);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.listDashboardItemIds(filter, query, sort);
    },
  },
  [M.loadDashboardItems]: {
    handle: async (runtime, params) => {
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
      return runtime.itemsSearch.loadDashboardItems(p.itemIds, p.offset, limit);
    },
  },
  [M.getItemById]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getItemById);
      const itemId = requireString(p.itemId, "itemId", M.getItemById);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.getItemById(itemId);
    },
  },
  [M.getAdjacentItems]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getAdjacentItems);
      const itemId = requireString(p.itemId, "itemId", M.getAdjacentItems);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.getAdjacentItems(itemId);
    },
  },
  [M.findSimilarItems]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.findSimilarItems);
      const itemId = requireString(p.itemId, "itemId", M.findSimilarItems);
      if (typeof p.limit !== "number" || !Number.isFinite(p.limit)) {
        badRequest(`${M.findSimilarItems}: limit must be a number`);
      }
      await runtime.ensureInitialized();
      return runtime.itemsSearch.findSimilarItems(itemId, p.limit);
    },
  },
  [M.resolveContentTextLinks]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.resolveContentTextLinks);
      const itemId = requireString(
        p.itemId,
        "itemId",
        M.resolveContentTextLinks,
      );
      if (typeof p.body !== "string") {
        badRequest(`${M.resolveContentTextLinks}: body must be a string`);
      }
      await runtime.ensureInitialized();
      return runtime.itemsSearch.resolveContentTextLinks(itemId, p.body);
    },
  },
  [M.listItemBacklinks]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.listItemBacklinks);
      const itemId = requireString(p.itemId, "itemId", M.listItemBacklinks);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.listItemBacklinks(itemId);
    },
  },
  [M.listItemOutboundLinks]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.listItemOutboundLinks);
      const itemId = requireString(
        p.itemId,
        "itemId",
        M.listItemOutboundLinks,
      );
      await runtime.ensureInitialized();
      return runtime.itemsSearch.listItemOutboundLinks(itemId);
    },
  },
  [M.addUserEdge]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.addUserEdge);
      const itemId = requireString(p.itemId, "itemId", M.addUserEdge);
      const otherItemId = requireString(
        p.otherItemId,
        "otherItemId",
        M.addUserEdge,
      );
      await runtime.ensureInitialized();
      await runtime.itemsSearch.addUserEdge(itemId, otherItemId);
      return null;
    },
  },
  [M.removeUserEdge]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.removeUserEdge);
      const itemId = requireString(p.itemId, "itemId", M.removeUserEdge);
      const otherItemId = requireString(
        p.otherItemId,
        "otherItemId",
        M.removeUserEdge,
      );
      await runtime.ensureInitialized();
      await runtime.itemsSearch.removeUserEdge(itemId, otherItemId);
      return null;
    },
  },
  [M.listUserEdges]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.listUserEdges);
      const itemId = requireString(p.itemId, "itemId", M.listUserEdges);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.listUserEdges(itemId);
    },
  },
  [M.getItemSource]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getItemSource);
      const itemId = requireString(p.itemId, "itemId", M.getItemSource);
      await runtime.ensureInitialized();
      return runtime.itemsSearch.getItemSource(itemId);
    },
  },
  [M.createItem]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.createItem);
      if (typeof p.title !== "string" || p.title.length === 0) {
        badRequest(`${M.createItem}: title required`);
      }
      if (typeof p.content_type !== "string") {
        badRequest(`${M.createItem}: content_type required`);
      }
      await runtime.ensureInitialized();
      return runtime.itemsSearch.createItem(p as unknown as CreateItemInput);
    },
  },
  [M.updateItem]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateItem);
      const itemId = requireString(p.itemId, "itemId", M.updateItem);
      if (!p.input || typeof p.input !== "object" || Array.isArray(p.input)) {
        badRequest(`${M.updateItem}: input object required`);
      }
      await runtime.ensureInitialized();
      return runtime.itemsSearch.updateItem(itemId, p.input as UpdateItemInput);
    },
  },
  [M.deleteItem]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteItem);
      const itemId = requireString(p.itemId, "itemId", M.deleteItem);
      await runtime.ensureInitialized();
      await runtime.itemsSearch.deleteItem(itemId);
      return { ok: true };
    },
  },
  [M.updateItemSource]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateItemSource);
      const itemId = requireString(p.itemId, "itemId", M.updateItemSource);
      const rawMarkdown = requireString(
        p.rawMarkdown,
        "rawMarkdown",
        M.updateItemSource,
      );
      await runtime.ensureInitialized();
      return runtime.itemsSearch.updateItemSource(itemId, rawMarkdown);
    },
  },
  [M.importDroppedFiles]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.importDroppedFiles);
      const files = decodeDroppedFiles(p.files, M.importDroppedFiles);
      const folder_path =
        typeof p.folder_path === "string" ? p.folder_path : undefined;
      await runtime.ensureInitialized();
      return runtime.dropImport.importDroppedFiles({ folder_path, files });
    },
  },
  [M.importFolder]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.importFolder);
      const sourceDirAbs = requireString(
        p.sourceDirAbs,
        "sourceDirAbs",
        M.importFolder,
      );
      if (p.targetFolderPath !== undefined && typeof p.targetFolderPath !== "string") {
        badRequest(`${M.importFolder}: targetFolderPath must be a string`);
      }
      const targetFolderPath =
        typeof p.targetFolderPath === "string" ? p.targetFolderPath : undefined;
      await runtime.ensureInitialized();
      return runtime.dropImport.importFolder({
        sourceDirAbs,
        ...(targetFolderPath === undefined ? {} : { targetFolderPath }),
      });
    },
  },
  [M.getImportFolderJob]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.getImportFolderJob);
      const jobId = requireString(p.jobId, "jobId", M.getImportFolderJob);
      await runtime.ensureInitialized();
      return runtime.dropImport.getImportFolderJob(jobId);
    },
  },
  [M.waitDerived]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.waitDerived);
      const itemId = requireString(p.itemId, "itemId", M.waitDerived);
      if (
        typeof p.contentRevision !== "number" ||
        !Number.isInteger(p.contentRevision)
      ) {
        badRequest(`${M.waitDerived}: contentRevision must be an integer`);
      }
      let timeoutMs: number | undefined;
      if (p.timeoutMs !== undefined) {
        if (typeof p.timeoutMs !== "number" || !Number.isFinite(p.timeoutMs)) {
          badRequest(`${M.waitDerived}: timeoutMs must be a number`);
        }
        timeoutMs = p.timeoutMs;
      }
      await runtime.ensureInitialized();
      return runtime.waitDerived.waitDerived(itemId, p.contentRevision, {
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    },
  },
} satisfies DomainDispatchGroup;
