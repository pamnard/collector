import {
  applyItemCover,
  listItemMediaWithPaths,
  type VaultContext,
} from "@collector/core";
import type { GeneratedCover, MediaType } from "@collector/shared";
import {
  generateCoverIdempotencyKey,
  generateCoverIdempotencyKeyPrefix,
  generateCoverJobType,
  type GenerateCoverJobPayload,
  folderPathFromItemPath,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";
import type { VaultPresentationChangedPayload } from "../../vault-presentation-changed.js";

export type GenerateCoverFromMedia = (
  data: Uint8Array,
  filename: string,
  mediaType: MediaType,
) => Promise<GeneratedCover | null>;

/** Prefer for video — ffmpeg reads the file path (no whole-file heap buffer). */
export type GenerateCoverFromMediaPath = (
  absolutePath: string,
  filename: string,
  mediaType: MediaType,
) => Promise<GeneratedCover | null>;

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function createGenerateCoverHandler(deps: {
  getContext: () => VaultContext;
  resolveVaultPath: (vaultId: string) => Promise<string>;
  generateCoverFromMedia: GenerateCoverFromMedia;
  /**
   * When set, video covers use the on-disk path (large YouTube attaches).
   * Images still go through {@link generateCoverFromMedia} unless this handles them.
   */
  generateCoverFromMediaPath?: GenerateCoverFromMediaPath;
  /** Drop host thumbnail path cache after on-disk cover write (#856). */
  invalidateThumbnailPathCache?: (itemId: string) => void;
  onVaultPresentationChanged?: (
    payload: VaultPresentationChangedPayload,
  ) => void;
}): TypedJobHandler<typeof generateCoverJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const {
      vaultId,
      itemId,
      mediaId,
      absolutePath,
      filename,
      mediaType,
    } = job.payload;
    const vaultPath = await deps.resolveVaultPath(vaultId);
    const ctx = deps.getContext();

    let cover: GeneratedCover | null;
    if (mediaType === "video" && deps.generateCoverFromMediaPath) {
      try {
        cover = await deps.generateCoverFromMediaPath(
          absolutePath,
          filename,
          mediaType,
        );
      } catch (error) {
        if (isEnoent(error)) {
          return { status: "ok" };
        }
        throw error;
      }
    } else {
      let data: Uint8Array;
      try {
        data = await ctx.fs.readBinary(absolutePath);
      } catch (error) {
        // Rapid multi-delete can remove the candidate before this job runs (#875).
        if (isEnoent(error)) {
          return { status: "ok" };
        }
        throw error;
      }

      cover = await deps.generateCoverFromMedia(
        data,
        filename,
        mediaType,
      );
    }
    if (!cover) {
      return {
        status: "fail",
        retryable: true,
        error: "generateCover returned null",
      };
    }

    // Running job may outlive the media (or a clear). Do not resurrect cover (#875).
    const media = await listItemMediaWithPaths(ctx, vaultPath, itemId);
    const source = media.find((entry) => entry.id === mediaId);
    if (!source) {
      return { status: "ok" };
    }

    await applyItemCover(
      ctx,
      vaultPath,
      vaultId,
      itemId,
      cover.data,
      cover.size,
      { sourceMediaId: mediaId, sourceFilename: source.filename },
    );
    deps.invalidateThumbnailPathCache?.(itemId);
    deps.onVaultPresentationChanged?.({
      vaultId,
      kind: "itemCoverChanged",
      itemId,
      folderPath: folderPathFromItemPath(itemId),
    });
    return { status: "ok" };
  };
}

/** Cancel pending generateCover jobs for one item so a newer preferred cover can win (#875). */
export function cancelPendingGenerateCoversForItem(
  queue: JobQueue,
  vaultId: string,
  itemId: string,
): Promise<number> {
  return queue.cancelPendingByIdempotencyKeyPrefix(
    generateCoverIdempotencyKeyPrefix({ vaultId, itemId }),
  );
}

/** Enqueue only — callers that supersede preferred/clear must cancel first (#875). */
export function enqueueGenerateCover(
  queue: JobQueue,
  payload: GenerateCoverJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "generateCover",
    payload,
    idempotencyKey: generateCoverIdempotencyKey(payload),
  });
}
