import {
  applyItemCover,
  listItemMediaWithPaths,
  type VaultContext,
} from "@collector/core";
import type { MediaType } from "@collector/shared";
import {
  generateCoverJobType,
  type GenerateCoverJobPayload,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export type GenerateCoverFromMedia = (
  data: Uint8Array,
  filename: string,
  mediaType: MediaType,
) => Promise<Uint8Array | null>;

export function createGenerateCoverHandler(deps: {
  getContext: () => VaultContext;
  resolveVaultPath: (vaultId: string) => Promise<string>;
  generateCoverFromMedia: GenerateCoverFromMedia;
  onVaultPresentationChanged?: (vaultId: string) => void;
}): TypedJobHandler<typeof generateCoverJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const { vaultId, itemId, mediaId } = job.payload;
    const vaultPath = await deps.resolveVaultPath(vaultId);
    const ctx = deps.getContext();
    const media = await listItemMediaWithPaths(ctx, vaultPath, itemId);
    const file = media.find((entry) => entry.id === mediaId);
    if (!file) {
      return {
        status: "fail",
        retryable: false,
        error: `media not found: ${mediaId}`,
      };
    }
    if (file.media_type !== "image" && file.media_type !== "video") {
      return {
        status: "fail",
        retryable: false,
        error: `cover unsupported media type: ${file.media_type}`,
      };
    }
    const data = await ctx.fs.readBinary(file.absolute_path);
    const cover = await deps.generateCoverFromMedia(
      data,
      file.filename,
      file.media_type,
    );
    if (!cover) {
      return {
        status: "fail",
        retryable: true,
        error: "generateCover returned null",
      };
    }
    await applyItemCover(ctx, vaultPath, vaultId, itemId, cover);
    deps.onVaultPresentationChanged?.(vaultId);
    return { status: "ok" };
  };
}

export function enqueueGenerateCover(
  queue: JobQueue,
  payload: GenerateCoverJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "generateCover",
    payload,
    idempotencyKey: `generateCover:${payload.vaultId}:${payload.itemId}:${payload.mediaId}`,
  });
}
