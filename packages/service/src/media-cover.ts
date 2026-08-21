/**
 * In-process media / cover / thumbnail path ops (#149).
 * Host injects vault accessors + cover/thumbnail adapters (Tauri/DOM stay outside).
 */

import type { AttachMediaFileInput, ItemHeroMedia, MediaWithPath } from "@collector/api";
import type {
  ItemFile,
  MediaFileMeta,
  VaultMeta,
  GenerateCoverJobPayload,
} from "@collector/shared";
import {
  attachMediaFile,
  clearItemCover,
  deleteMediaFile,
  listItemMediaWithPaths,
  readItemFile,
  replaceMediaFile,
  resolveItemHeroMedia,
  touchItemUpdatedAt,
  type VaultContext,
} from "@collector/core";
import type { TerminalJobStatus } from "./jobs/job-wait.js";

export type ResolveThumbnailPathsBatch = (
  vaultPath: string,
  items: Array<{ id: string; thumbnail: string | null }>,
) => Promise<Array<{ id: string; path: string | null }>>;

export interface MediaCoverServiceDeps {
  resolveActiveVault: () => Promise<{ vault: VaultMeta; path: string }>;
  getContext: () => VaultContext;
  /** Durable cover job (#636 / #639) — returns enqueue id. */
  enqueueGenerateCover: (
    input: GenerateCoverJobPayload,
  ) => Promise<{ id: string }>;
  /** Wait until generateCover leaves pending/running. */
  waitForCoverJob: (jobId: string) => Promise<TerminalJobStatus>;
  resolveThumbnailPathsBatch: ResolveThumbnailPathsBatch;
  onVaultPresentationChanged?: (vaultId: string) => void;
}

export interface MediaCoverService {
  listItemMedia(itemId: string): Promise<MediaWithPath[]>;
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
  resolveItemHeroMedia(item: ItemFile): Promise<ItemHeroMedia | null>;
  setItemCoverFromMedia(itemId: string, mediaId: string): Promise<ItemFile>;
  attachMediaFiles(
    itemId: string,
    files: AttachMediaFileInput[],
  ): Promise<MediaFileMeta[]>;
  replaceItemMedia(
    itemId: string,
    mediaId: string,
    file: AttachMediaFileInput,
  ): Promise<MediaFileMeta>;
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

  const invalidateThumbnailPathCache = (itemId: string): void => {
    itemThumbnailPathCache.delete(itemId);
  };

  const afterMediaPresentationChange = async (itemId: string): Promise<void> => {
    const { vault, path } = await deps.resolveActiveVault();
    invalidateThumbnailPathCache(itemId);
    await touchItemUpdatedAt(deps.getContext(), path, vault.id, itemId);
    await enqueuePreferredCover(itemId);
    deps.onVaultPresentationChanged?.(vault.id);
  };

  const listItemMedia = async (itemId: string): Promise<MediaWithPath[]> => {
    const { path } = await deps.resolveActiveVault();
    return listItemMediaWithPaths(deps.getContext(), path, itemId);
  };

  const enqueuePreferredCover = async (itemId: string): Promise<void> => {
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

    const mediaType = candidate.media_type;
    if (mediaType !== "image" && mediaType !== "video") {
      throw new Error(`cover unsupported media type: ${mediaType}`);
    }
    await deps.enqueueGenerateCover({
      vaultId: vault.id,
      itemId,
      mediaId: candidate.id,
      absolutePath: candidate.absolute_path,
      filename: candidate.filename,
      mediaType,
    });
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

    const { id: jobId } = await deps.enqueueGenerateCover({
      vaultId: vault.id,
      itemId,
      mediaId: file.id,
      absolutePath: file.absolute_path,
      filename: file.filename,
      mediaType: file.media_type,
    });
    const terminal = await deps.waitForCoverJob(jobId);
    if (terminal !== "succeeded") {
      throw new Error(`generateCover ${jobId} finished as ${terminal}`);
    }
    return readItemFile(ctx.fs, path, itemId, vault.id);
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
          filename: file.name,
          data: file.bytes,
        }),
      );
    }
    await afterMediaPresentationChange(itemId);
    return attached;
  };

  const replaceItemMedia = async (
    itemId: string,
    mediaId: string,
    file: AttachMediaFileInput,
  ): Promise<MediaFileMeta> => {
    const { path } = await deps.resolveActiveVault();
    const replaced = await replaceMediaFile(deps.getContext(), path, itemId, mediaId, {
      filename: file.name,
      data: file.bytes,
    });
    await afterMediaPresentationChange(itemId);
    return replaced;
  };

  const deleteItemMedia = async (
    itemId: string,
    mediaId: string,
  ): Promise<void> => {
    const { path } = await deps.resolveActiveVault();
    await deleteMediaFile(deps.getContext(), path, itemId, mediaId);
    await afterMediaPresentationChange(itemId);
  };

  return {
    listItemMedia,
    resolveItemThumbnailPath,
    resolveItemThumbnailPaths,
    resolveItemHeroMedia: async (item) => {
      const { path } = await deps.resolveActiveVault();
      return resolveItemHeroMedia(deps.getContext().fs, path, item.id);
    },
    setItemCoverFromMedia: async (itemId, mediaId) => {
      const item = await setItemCoverFromMedia(itemId, mediaId);
      const { vault } = await deps.resolveActiveVault();
      deps.onVaultPresentationChanged?.(vault.id);
      return item;
    },
    attachMediaFiles,
    replaceItemMedia,
    deleteItemMedia,
  };
}
