import type { ItemFile } from "@collector/shared";
import { dashboardSnapshotSchema } from "@collector/shared";
import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, badRequest, requireString } from "../handlers/params.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const DASHBOARD_DISPATCH = {
  [M.ensureDashboardSnapshot]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.dashboardSnapshot.ensureDashboardSnapshot();
    },
  },
  [M.persistDashboardSnapshot]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.persistDashboardSnapshot);
      if (!p.snapshot || typeof p.snapshot !== "object" || Array.isArray(p.snapshot)) {
        badRequest(`${M.persistDashboardSnapshot}: snapshot object required`);
      }
      const snapshot = dashboardSnapshotSchema.parse(p.snapshot);
      await runtime.ensureInitialized();
      await runtime.dashboardSnapshot.persistDashboardSnapshot(snapshot);
      return { ok: true };
    },
  },
  [M.clearDashboardSnapshot]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      await runtime.dashboardSnapshot.clearDashboardSnapshot();
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
          : requireString(item.thumbnail, "item.thumbnail", M.resolveItemThumbnailPath);
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
          badRequest(`${M.resolveItemThumbnailPaths}: items[${index}] object required`);
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
  [M.resolveItemHeroMedia]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.resolveItemHeroMedia);
      if (!p.item || typeof p.item !== "object" || Array.isArray(p.item)) {
        badRequest(`${M.resolveItemHeroMedia}: item object required`);
      }
      const item = p.item as Record<string, unknown>;
      const id = requireString(item.id, "item.id", M.resolveItemHeroMedia);
      await runtime.ensureInitialized();
      return runtime.mediaCover.resolveItemHeroMedia({ id } as ItemFile);
    },
  },
} satisfies DomainDispatchGroup;
