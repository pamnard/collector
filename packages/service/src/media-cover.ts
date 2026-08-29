/**
 * In-process media / cover / thumbnail path ops (#149).
 * Host injects vault accessors + cover/thumbnail adapters (Tauri/DOM stay outside).
 */

import type {
  AttachMediaFileInput,
  ItemHeroMedia,
  ItemThumbnailPixelSize,
  ItemThumbnailResolved,
  MediaWithPath,
} from "@collector/api";
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
  readItemCoverSize,
  readItemFile,
  replaceMediaFile,
  resolveItemHeroMedia,
  touchItemUpdatedAt,
  writeItemCoverSize,
  type VaultContext,
} from "@collector/core";
import { folderPathFromItemPath } from "@collector/shared";
import type { TerminalJobStatus } from "./jobs/job-wait.js";
import type { VaultPresentationChangedPayload } from "./vault-presentation-changed.js";

export type ResolveThumbnailPathsProgressive = (
  vaultPath: string,
  items: Array<{ id: string; thumbnail: string | null }>,
  options: {
    onResolved: (result: { id: string; path: string | null }) => void;
    concurrency?: number;
  },
) => Promise<void>;

export type ItemThumbnailCacheEntry = {
  cacheKey: string;
  path: string | null;
  size: ItemThumbnailPixelSize | null;
};

/**
 * Explicit browser / DevMock stub for in-process compose.
 * Never omit {@link MediaCoverServiceDeps.readCoverPixelSize} — inject this
 * (or another real reader) so missing SoT cannot silently become `size: null`.
 */
export async function stubReadCoverPixelSizeUnavailable(
  absolutePath: string,
): Promise<ItemThumbnailPixelSize> {
  throw new Error(
    `readCoverPixelSize unavailable outside Node host: ${absolutePath}`,
  );
}

export interface MediaCoverServiceDeps {
  resolveActiveVault: () => Promise<{ vault: VaultMeta; path: string }>;
  getContext: () => VaultContext;
  /** Durable cover job (#636 / #639) — returns enqueue id. */
  enqueueGenerateCover: (
    input: GenerateCoverJobPayload,
  ) => Promise<{ id: string }>;
  /** Wait until generateCover leaves pending/running. */
  waitForCoverJob: (jobId: string) => Promise<TerminalJobStatus>;
  /**
   * Cancel pending generateCover jobs when the item has no cover candidate left
   * (#875). Preferred-cover replace cancels inside enqueueGenerateCover.
   */
  cancelPendingGenerateCoversForItem: (
    vaultId: string,
    itemId: string,
  ) => Promise<number>;
  /**
   * Progressive path resolve (#544 / #823). Size reads overlap remaining path
   * work so early ids finish before the last sibling path probe.
   */
  resolveThumbnailPathsProgressive: ResolveThumbnailPathsProgressive;
  /**
   * Required pixel-size reader for one-time size backfill when
   * `cover.size.json` is missing (#822). Node host injects sharp.metadata;
   * browser / DevMock in-process must pass
   * {@link stubReadCoverPixelSizeUnavailable} (or an explicit alternative) —
   * never silent omit (#821).
   */
  readCoverPixelSize: (
    absolutePath: string,
  ) => Promise<ItemThumbnailPixelSize>;
  onVaultPresentationChanged?: (
    payload: VaultPresentationChangedPayload,
  ) => void;
}

export interface MediaCoverService {
  listItemMedia(itemId: string): Promise<MediaWithPath[]>;
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
  /** Path + cover pixel size for dashboard slot reservation. */
  resolveItemThumbnailEntries(
    items: ItemFile[],
  ): Promise<Map<string, ItemThumbnailResolved>>;
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
  /**
   * Drop cached thumbnail path/size for one item (#856).
   * Call after on-disk cover write so a prior null resolve cannot stick.
   */
  invalidateThumbnailPathCache(itemId: string): void;
}

function itemThumbnailCacheKey(item: ItemFile): string {
  return `${item.thumbnail ?? ""}:${item.updated_at}`;
}

export function createMediaCoverService(
  deps: MediaCoverServiceDeps,
): MediaCoverService {
  const itemThumbnailPathCache = new Map<string, ItemThumbnailCacheEntry>();
  /** Serialize preferred-cover enqueue/clear per item across parallel deletes (#875). */
  const presentationChangeByItem = new Map<string, Promise<void>>();

  const invalidateThumbnailPathCache = (itemId: string): void => {
    itemThumbnailPathCache.delete(itemId);
  };

  const runSerializedPresentationChange = (
    itemId: string,
    work: () => Promise<void>,
  ): Promise<void> => {
    const previous = presentationChangeByItem.get(itemId) ?? Promise.resolve();
    const next = previous.then(work, work);
    presentationChangeByItem.set(itemId, next);
    // Swallow rethrow from finally so a failed work does not become unhandledRejection
    // (caller still awaits `next` and sees the error).
    void next
      .finally(() => {
        if (presentationChangeByItem.get(itemId) === next) {
          presentationChangeByItem.delete(itemId);
        }
      })
      .catch(() => {});
    return next;
  };

  /**
   * After media attach/replace/delete: bump stamp + enqueue cover (or clear).
   * `itemCoverChanged` only when the on-disk cover was cleared here (#856).
   * Successful generateCover emits after applyItemCover — not at enqueue time.
   */
  const afterMediaPresentationChange = async (itemId: string): Promise<void> => {
    await runSerializedPresentationChange(itemId, async () => {
      const { vault, path } = await deps.resolveActiveVault();
      invalidateThumbnailPathCache(itemId);
      await touchItemUpdatedAt(deps.getContext(), path, vault.id, itemId);
      const outcome = await enqueuePreferredCover(itemId);
      if (outcome === "cleared") {
        deps.onVaultPresentationChanged?.({
          vaultId: vault.id,
          kind: "itemCoverChanged",
          itemId,
          folderPath: folderPathFromItemPath(itemId),
        });
      }
    });
  };

  const listItemMedia = async (itemId: string): Promise<MediaWithPath[]> => {
    const { path } = await deps.resolveActiveVault();
    return listItemMediaWithPaths(deps.getContext(), path, itemId);
  };

  const enqueuePreferredCover = async (
    itemId: string,
  ): Promise<"cleared" | "enqueued"> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const media = await listItemMediaWithPaths(ctx, path, itemId);
    const candidate =
      media.find((file) => file.media_type === "image") ??
      media.find((file) => file.media_type === "video");

    if (!candidate) {
      await clearItemCover(ctx, path, vault.id, itemId);
      await deps.cancelPendingGenerateCoversForItem(vault.id, itemId);
      return "cleared";
    }

    const mediaType = candidate.media_type;
    if (mediaType !== "image" && mediaType !== "video") {
      throw new Error(`cover unsupported media type: ${mediaType}`);
    }
    await deps.cancelPendingGenerateCoversForItem(vault.id, itemId);
    await deps.enqueueGenerateCover({
      vaultId: vault.id,
      itemId,
      mediaId: candidate.id,
      absolutePath: candidate.absolute_path,
      filename: candidate.filename,
      mediaType,
    });
    return "enqueued";
  };

  /**
   * Prefer cover.size.json; sharp.metadata only once when the sidecar is missing (#822).
   */
  const resolveCoverPixelSize = async (
    vaultPath: string,
    itemId: string,
    absoluteCoverPath: string,
  ): Promise<ItemThumbnailPixelSize | null> => {
    const ctx = deps.getContext();
    const stored = await readItemCoverSize(ctx.fs, vaultPath, itemId);
    if (stored) {
      return stored;
    }

    console.warn(
      "[media-cover] cover size sidecar missing; backfilling via sharp.metadata",
      { itemId, absoluteCoverPath },
    );
    const size = await deps.readCoverPixelSize(absoluteCoverPath);
    await writeItemCoverSize(ctx.fs, vaultPath, itemId, size);
    return size;
  };

  const resolveItemThumbnailPathsUncached = async (
    items: ItemFile[],
  ): Promise<Map<string, ItemThumbnailResolved>> => {
    if (!items.length) {
      return new Map();
    }

    const { path: vaultPath } = await deps.resolveActiveVault();
    const resolved = new Map<string, ItemThumbnailResolved>();
    const sizeJobs: Promise<void>[] = [];

    await deps.resolveThumbnailPathsProgressive(
      vaultPath,
      items.map((item) => ({
        id: item.id,
        thumbnail: item.thumbnail ?? null,
      })),
      {
        onResolved: (row) => {
          sizeJobs.push(
            (async () => {
              if (row.path === null) {
                resolved.set(row.id, { path: null, size: null });
                return;
              }
              const size = await resolveCoverPixelSize(
                vaultPath,
                row.id,
                row.path,
              );
              resolved.set(row.id, { path: row.path, size });
            })(),
          );
        },
      },
    );

    await Promise.all(sizeJobs);
    return resolved;
  };

  const resolveItemThumbnailEntries = async (
    items: ItemFile[],
  ): Promise<Map<string, ItemThumbnailResolved>> => {
    if (!items.length) {
      return new Map();
    }

    const uncached: ItemFile[] = [];
    const resolved = new Map<string, ItemThumbnailResolved>();

    for (const item of items) {
      const cacheKey = itemThumbnailCacheKey(item);
      const cached = itemThumbnailPathCache.get(item.id);
      if (cached && cached.cacheKey === cacheKey) {
        resolved.set(item.id, { path: cached.path, size: cached.size });
        continue;
      }
      uncached.push(item);
    }

    if (uncached.length) {
      const fresh = await resolveItemThumbnailPathsUncached(uncached);
      for (const item of uncached) {
        const entry = fresh.get(item.id);
        if (!entry) {
          throw new Error(
            `thumbnail resolve missing id in batch result: ${item.id}`,
          );
        }
        itemThumbnailPathCache.set(item.id, {
          cacheKey: itemThumbnailCacheKey(item),
          path: entry.path,
          size: entry.size,
        });
        resolved.set(item.id, entry);
      }
    }

    return resolved;
  };

  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    const entries = await resolveItemThumbnailEntries(items);
    const resolved = new Map<string, string | null>();
    for (const [id, entry] of entries) {
      resolved.set(id, entry.path);
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

    await deps.cancelPendingGenerateCoversForItem(vault.id, itemId);
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
    resolveItemThumbnailEntries,
    resolveItemHeroMedia: async (item) => {
      const { path } = await deps.resolveActiveVault();
      return resolveItemHeroMedia(deps.getContext().fs, path, item.id);
    },
    setItemCoverFromMedia: async (itemId, mediaId) => {
      const item = await setItemCoverFromMedia(itemId, mediaId);
      const { vault } = await deps.resolveActiveVault();
      deps.onVaultPresentationChanged?.({
        vaultId: vault.id,
        kind: "itemCoverChanged",
        itemId: item.id,
        folderPath: item.folder_path,
      });
      return item;
    },
    attachMediaFiles,
    replaceItemMedia,
    deleteItemMedia,
    invalidateThumbnailPathCache,
  };
}
