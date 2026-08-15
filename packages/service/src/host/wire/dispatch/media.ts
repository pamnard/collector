import type { ItemFile } from "@collector/shared";
import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, badRequest, requireString } from "../handlers/params.js";
import { decodeMediaFiles } from "./decode.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Media + thumbnail resolve (#159 / #552). */
export const MEDIA_DISPATCH = defineDispatch({
  [M.listItemMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.listItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.listItemMedia);
      await runtime.ensureInitialized();
      return runtime.mediaCover.listItemMedia(itemId);
    },
  },
  [M.setItemCoverFromMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.setItemCoverFromMedia);
      const itemId = requireString(p.itemId, "itemId", M.setItemCoverFromMedia);
      const mediaId = requireString(
        p.mediaId,
        "mediaId",
        M.setItemCoverFromMedia,
      );
      await runtime.ensureInitialized();
      return runtime.mediaCover.setItemCoverFromMedia(itemId, mediaId);
    },
  },
  [M.attachMediaFiles]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.attachMediaFiles);
      const itemId = requireString(p.itemId, "itemId", M.attachMediaFiles);
      const files = decodeMediaFiles(p.files, M.attachMediaFiles);
      await runtime.ensureInitialized();
      return runtime.mediaCover.attachMediaFiles(itemId, files);
    },
  },
  [M.replaceItemMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.replaceItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.replaceItemMedia);
      const mediaId = requireString(p.mediaId, "mediaId", M.replaceItemMedia);
      if (!p.file || typeof p.file !== "object" || Array.isArray(p.file)) {
        badRequest(`${M.replaceItemMedia}: file object required`);
      }
      const [decoded] = decodeMediaFiles([p.file], M.replaceItemMedia);
      await runtime.ensureInitialized();
      return runtime.mediaCover.replaceItemMedia(itemId, mediaId, decoded!);
    },
  },
  [M.deleteItemMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteItemMedia);
      const itemId = requireString(p.itemId, "itemId", M.deleteItemMedia);
      const mediaId = requireString(p.mediaId, "mediaId", M.deleteItemMedia);
      await runtime.ensureInitialized();
      await runtime.mediaCover.deleteItemMedia(itemId, mediaId);
      return { ok: true };
    },
  },
  [M.resolveItemThumbnailPath]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.resolveItemThumbnailPath);
      if (!p.item || typeof p.item !== "object" || Array.isArray(p.item)) {
        badRequest(`${M.resolveItemThumbnailPath}: item object required`);
      }
      const item = p.item as Record<string, unknown>;
      const id = requireString(item.id, "item.id", M.resolveItemThumbnailPath);
      const thumbnail =
        item.thumbnail === null || item.thumbnail === undefined
          ? null
          : requireString(
              item.thumbnail,
              "item.thumbnail",
              M.resolveItemThumbnailPath,
            );
      await runtime.ensureInitialized();
      return runtime.mediaCover.resolveItemThumbnailPath({
        id,
        thumbnail,
      } as ItemFile);
    },
  },
  [M.resolveItemThumbnailPaths]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.resolveItemThumbnailPaths);
      if (!Array.isArray(p.items)) {
        badRequest(`${M.resolveItemThumbnailPaths}: items array required`);
      }
      const items: ItemFile[] = p.items.map((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          badRequest(
            `${M.resolveItemThumbnailPaths}: items[${index}] object required`,
          );
        }
        const r = row as Record<string, unknown>;
        const id = requireString(
          r.id,
          `items[${index}].id`,
          M.resolveItemThumbnailPaths,
        );
        const thumbnail =
          r.thumbnail === null || r.thumbnail === undefined
            ? null
            : typeof r.thumbnail === "string"
              ? r.thumbnail
              : badRequest(
                  `${M.resolveItemThumbnailPaths}: items[${index}].thumbnail must be string or null`,
                );
        return { id, thumbnail } as ItemFile;
      });
      await runtime.ensureInitialized();
      const resolved = await runtime.mediaCover.resolveItemThumbnailPaths(items);
      return Array.from(resolved, ([id, path]) => ({ id, path }));
    },
  },
});
