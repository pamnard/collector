/**
 * IPC handlers: media / cover / thumbnails (#159).
 */

import type { AttachMediaFileInput } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  asObject,
  badRequest,
  requireString,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

function requireFileName(
  row: Record<string, unknown>,
  label: string,
  method: string,
): string {
  if (typeof row.name === "string" && row.name.length > 0) {
    return row.name;
  }
  if (typeof row.filename === "string" && row.filename.length > 0) {
    return row.filename;
  }
  badRequest(`${method}: ${label} name or filename required`);
}

function decodeMediaFiles(
  value: unknown,
  method: string,
): AttachMediaFileInput[] {
  if (!Array.isArray(value)) {
    badRequest(`${method}: files must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      badRequest(`${method}: files[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const name = requireFileName(row, `files[${index}]`, method);
    if (typeof row.dataBase64 !== "string") {
      badRequest(`${method}: files[${index}].dataBase64 must be a string`);
    }
    return {
      name,
      bytes: Uint8Array.from(Buffer.from(row.dataBase64, "base64")),
    };
  });
}

export function buildMediaHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { mediaCover } = runtime;
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.listItemMedia]: async (params) => {
      const p = asObject(params, M.listItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.listItemMedia);
      await runtime.ensureInitialized();
      return mediaCover.listItemMedia(itemId);
    },
    [M.resolveItemThumbnailPath]: async (params) => {
      const p = asObject(params, M.resolveItemThumbnailPath);
      if (!p.item || typeof p.item !== "object" || Array.isArray(p.item)) {
        badRequest(`${M.resolveItemThumbnailPath}: item object required`);
      }
      await runtime.ensureInitialized();
      return mediaCover.resolveItemThumbnailPath(p.item as ItemFile);
    },
    [M.resolveItemThumbnailPaths]: async (params) => {
      const p = asObject(params, M.resolveItemThumbnailPaths);
      if (!Array.isArray(p.items)) {
        badRequest(`${M.resolveItemThumbnailPaths}: items must be an array`);
      }
      await runtime.ensureInitialized();
      const map = await mediaCover.resolveItemThumbnailPaths(
        p.items as ItemFile[],
      );
      return Object.fromEntries(map);
    },
    [M.setItemCoverFromMedia]: async (params) => {
      const p = asObject(params, M.setItemCoverFromMedia);
      const itemId = requireString(p.itemId, "itemId", M.setItemCoverFromMedia);
      const mediaId = requireString(p.mediaId, "mediaId", M.setItemCoverFromMedia);
      await runtime.ensureInitialized();
      return mediaCover.setItemCoverFromMedia(itemId, mediaId);
    },
    [M.attachMediaFiles]: async (params) => {
      const p = asObject(params, M.attachMediaFiles);
      const itemId = requireString(p.itemId, "itemId", M.attachMediaFiles);
      const files = decodeMediaFiles(p.files, M.attachMediaFiles);
      await runtime.ensureInitialized();
      return mediaCover.attachMediaFiles(itemId, files);
    },
    [M.replaceItemMedia]: async (params) => {
      const p = asObject(params, M.replaceItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.replaceItemMedia);
      const mediaId = requireString(p.mediaId, "mediaId", M.replaceItemMedia);
      if (!p.file || typeof p.file !== "object" || Array.isArray(p.file)) {
        badRequest(`${M.replaceItemMedia}: file object required`);
      }
      const [decoded] = decodeMediaFiles([p.file], M.replaceItemMedia);
      await runtime.ensureInitialized();
      return mediaCover.replaceItemMedia(itemId, mediaId, decoded!);
    },
    [M.deleteItemMedia]: async (params) => {
      const p = asObject(params, M.deleteItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.deleteItemMedia);
      const mediaId = requireString(p.mediaId, "mediaId", M.deleteItemMedia);
      await runtime.ensureInitialized();
      await mediaCover.deleteItemMedia(itemId, mediaId);
      return { ok: true };
    },
  };
}
