/**
 * In-process media / cover / thumbnail path ops (#149).
 * Host injects vault accessors + cover/thumbnail adapters (Tauri/DOM stay outside).
 */

import type { AttachMediaFileInput, MediaWithPath } from "@collector/api";
import type { ItemFile, MediaFileMeta, MediaType, VaultMeta } from "@collector/shared";
import {
  applyItemCover,
  attachMediaFile,
  clearItemCover,
  deleteMediaFile,
  listItemMediaWithPaths,
  type VaultContext,
} from "@collector/core";

export type GenerateCoverFromMedia = (
  data: Uint8Array,
  filename: string,
  mediaType: MediaType,
) => Promise<Uint8Array | null>;

export type ResolveThumbnailPathsBatch = (
  vaultPath: string,
  items: Array<{ id: string; thumbnail: string | null }>,
) => Promise<Array<{ id: string; path: string | null }>>;

export interface MediaCoverServiceDeps {
  resolveActiveVault: () => Promise<{ vault: VaultMeta; path: string }>;
  getContext: () => VaultContext;
  generateCoverFromMedia: GenerateCoverFromMedia;
  resolveThumbnailPathsBatch: ResolveThumbnailPathsBatch;
}

export interface MediaCoverService {
  listItemMedia(itemId: string): Promise<MediaWithPath[]>;
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
  setItemCoverFromMedia(itemId: string, mediaId: string): Promise<ItemFile>;
  attachMediaFiles(
    itemId: string,
    files: AttachMediaFileInput[],
  ): Promise<MediaFileMeta[]>;
  deleteItemMedia(itemId: string, mediaId: string): Promise<void>;
}

function itemThumbnailCacheKey(item: ItemFile): string {
  return `${item.thumbnail ?? ""}:${item.updated_at}`;
}

export function createMediaCoverService(
  deps: MediaCoverServiceDeps,
): MediaCoverService {
  const itemThumbnailPathCache = new Map<
    string,
    { cacheKey: string; path: string | null }
  >();

  const listItemMedia = async (itemId: string): Promise<MediaWithPath[]> => {
    const { path } = await deps.resolveActiveVault();
    return listItemMediaWithPaths(deps.getContext(), path, itemId);
  };

  const syncItemCover = async (itemId: string): Promise<void> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const media = await listItemMediaWithPaths(ctx, path, itemId);
    const candidate =
      media.find((file) => file.media_type === "image") ??
      media.find((file) => file.media_type === "video");

    if (!candidate) {
      await clearItemCover(ctx, path, vault.id, itemId);
      return;
    }

    const data = await ctx.fs.readBinary(candidate.absolute_path);
    const cover = await deps.generateCoverFromMedia(
      data,
      candidate.filename,
      candidate.media_type,
    );

    if (cover) {
      await applyItemCover(ctx, path, vault.id, itemId, cover);
    } else {
      await clearItemCover(ctx, path, vault.id, itemId);
    }
  };

  const resolveItemThumbnailPathsUncached = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    if (!items.length) {
      return new Map();
    }

    const { path } = await deps.resolveActiveVault();
    const rows = await deps.resolveThumbnailPathsBatch(
      path,
      items.map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
      })),
    );

    const resolved = new Map<string, string | null>();
    for (const row of rows) {
      resolved.set(row.id, row.path);
    }
    return resolved;
  };

  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    if (!items.length) {
      return new Map();
    }

    const uncached: ItemFile[] = [];
    const resolved = new Map<string, string | null>();

    for (const item of items) {
      const cacheKey = itemThumbnailCacheKey(item);
      const cached = itemThumbnailPathCache.get(item.id);
      if (cached && cached.cacheKey === cacheKey) {
        resolved.set(item.id, cached.path);
        continue;
      }
      uncached.push(item);
    }

    if (uncached.length) {
      const fresh = await resolveItemThumbnailPathsUncached(uncached);
      for (const item of uncached) {
        const path = fresh.get(item.id) ?? null;
        itemThumbnailPathCache.set(item.id, {
          cacheKey: itemThumbnailCacheKey(item),
          path,
        });
        resolved.set(item.id, path);
      }
    }

    return resolved;
  };

  const resolveItemThumbnailPath = async (
    item: ItemFile,
  ): Promise<string | null> => {
    const paths = await resolveItemThumbnailPaths([item]);
    return paths.get(item.id) ?? null;
  };

  const setItemCoverFromMedia = async (
    itemId: string,
    mediaId: string,
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const media = await listItemMediaWithPaths(ctx, path, itemId);
    const file = media.find((entry) => entry.id === mediaId);

    if (!file) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    if (file.media_type !== "image" && file.media_type !== "video") {
      throw new Error("Cover can only be set from image or video files");
    }

    const data = await ctx.fs.readBinary(file.absolute_path);
    const cover = await deps.generateCoverFromMedia(
      data,
      file.filename,
      file.media_type,
    );

    if (!cover) {
      throw new Error("Failed to generate cover from media");
    }

    return applyItemCover(ctx, path, vault.id, itemId, cover);
  };

  const attachMediaFiles = async (
    itemId: string,
    files: AttachMediaFileInput[],
  ): Promise<MediaFileMeta[]> => {
    const { path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const attached: MediaFileMeta[] = [];
    for (const file of files) {
      attached.push(
        await attachMediaFile(ctx, path, itemId, {
          filename: file.filename,
          data: file.data,
        }),
      );
    }
    await syncItemCover(itemId);
    return attached;
  };

  const deleteItemMedia = async (
    itemId: string,
    mediaId: string,
  ): Promise<void> => {
    const { path } = await deps.resolveActiveVault();
    await deleteMediaFile(deps.getContext(), path, itemId, mediaId);
    await syncItemCover(itemId);
  };

  return {
    listItemMedia,
    resolveItemThumbnailPath,
    resolveItemThumbnailPaths,
    setItemCoverFromMedia,
    attachMediaFiles,
    deleteItemMedia,
  };
}
