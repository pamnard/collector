/**
 * IPC handlers: item create/update/delete (#156).
 */

import type { CreateItemInput, UpdateItemInput } from "@collector/api";
import {
  asObject,
  badRequest,
  requireString,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildItemsWriteHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { itemsSearch } = runtime;
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.createItem]: async (params) => {
      const p = asObject(params, M.createItem);
      if (typeof p.title !== "string" || p.title.length === 0) {
        badRequest(`${M.createItem}: title required`);
      }
      if (typeof p.content_type !== "string") {
        badRequest(`${M.createItem}: content_type required`);
      }
      const input = p as unknown as CreateItemInput;
      await runtime.ensureInitialized();
      return itemsSearch.createItem(input);
    },
    [M.updateItem]: async (params) => {
      const p = asObject(params, M.updateItem);
      const itemId = requireString(p.itemId, "itemId", M.updateItem);
      if (!p.input || typeof p.input !== "object" || Array.isArray(p.input)) {
        badRequest(`${M.updateItem}: input object required`);
      }
      await runtime.ensureInitialized();
      return itemsSearch.updateItem(itemId, p.input as UpdateItemInput);
    },
    [M.deleteItem]: async (params) => {
      const p = asObject(params, M.deleteItem);
      const itemId = requireString(p.itemId, "itemId", M.deleteItem);
      await runtime.ensureInitialized();
      await itemsSearch.deleteItem(itemId);
      return { ok: true };
    },
    [M.updateItemSource]: async (params) => {
      const p = asObject(params, M.updateItemSource);
      const itemId = requireString(p.itemId, "itemId", M.updateItemSource);
      const rawMarkdown = requireString(
        p.rawMarkdown,
        "rawMarkdown",
        M.updateItemSource,
      );
      await runtime.ensureInitialized();
      return itemsSearch.updateItemSource(itemId, rawMarkdown);
    },
  };
}
