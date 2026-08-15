import {
  DOMAIN_WIRE_METHODS,
  type DomainWireMethod,
} from "../domain-methods.js";
import { asObject, badRequest, requireString } from "../handlers/params.js";
import { decodeMediaFiles } from "./decode.js";
import type { DomainDispatchEntry } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const MEDIA_DISPATCH: Partial<Record<DomainWireMethod, DomainDispatchEntry>> = {
  // #159 media
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
};
