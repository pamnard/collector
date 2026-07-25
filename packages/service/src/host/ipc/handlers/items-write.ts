/**
 * IPC handlers: item create/update/delete (#156) + drop import (#22).
 */

import type {
  CreateItemInput,
  ImportDroppedFilesInput,
  UpdateItemInput,
} from "@collector/api";
import {
  asObject,
  badRequest,
  requireString,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

function decodeDroppedFiles(
  files: unknown,
  method: string,
): ImportDroppedFilesInput["files"] {
  if (!Array.isArray(files)) {
    badRequest(`${method}: files array required`);
  }
  return files.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      badRequest(`${method}: files[${index}] object required`);
    }
    const r = row as Record<string, unknown>;
    if (typeof r.relativePath !== "string" || !r.relativePath) {
      badRequest(`${method}: files[${index}].relativePath required`);
    }
    if (typeof r.filename !== "string" || !r.filename) {
      badRequest(`${method}: files[${index}].filename required`);
    }
    if (typeof r.dataBase64 !== "string") {
      badRequest(`${method}: files[${index}].dataBase64 required`);
    }
    return {
      relativePath: r.relativePath,
      filename: r.filename,
      data: Uint8Array.from(Buffer.from(r.dataBase64, "base64")),
    };
  });
}

export function buildItemsWriteHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { itemsSearch, dropImport } = runtime;
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
    [M.importDroppedFiles]: async (params) => {
      const p = asObject(params, M.importDroppedFiles);
      const files = decodeDroppedFiles(p.files, M.importDroppedFiles);
      const folder_path =
        typeof p.folder_path === "string" ? p.folder_path : undefined;
      await runtime.ensureInitialized();
      return dropImport.importDroppedFiles({ folder_path, files });
    },
  };
}
