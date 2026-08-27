import { applyItemCover, type VaultContext } from "@collector/core";
import type { GeneratedCover, MediaType } from "@collector/shared";
import {
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

export function createGenerateCoverHandler(deps: {
  getContext: () => VaultContext;
  resolveVaultPath: (vaultId: string) => Promise<string>;
  generateCoverFromMedia: GenerateCoverFromMedia;
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
      absolutePath,
      filename,
      mediaType,
    } = job.payload;
    const vaultPath = await deps.resolveVaultPath(vaultId);
    const ctx = deps.getContext();
    const data = await ctx.fs.readBinary(absolutePath);
    const cover = await deps.generateCoverFromMedia(
      data,
      filename,
      mediaType,
    );
    if (!cover) {
      return {
        status: "fail",
        retryable: true,
        error: "generateCover returned null",
      };
    }
    await applyItemCover(
      ctx,
      vaultPath,
      vaultId,
      itemId,
      cover.data,
      cover.size,
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
