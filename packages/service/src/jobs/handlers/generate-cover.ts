import { applyItemCover, type VaultContext } from "@collector/core";
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

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

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

    // Source may be gone after rapid multi-delete (#875). Quiet success — not AlertStack.
    if (!(await ctx.fs.exists(absolutePath))) {
      return { status: "ok" };
    }

    let data: Uint8Array;
    try {
      data = await ctx.fs.readBinary(absolutePath);
    } catch (error) {
      if (isEnoent(error)) {
        return { status: "ok" };
      }
      throw error;
    }

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

export async function enqueueGenerateCover(
  queue: JobQueue,
  payload: GenerateCoverJobPayload,
): Promise<EnqueueResult> {
  await cancelPendingGenerateCoversForItem(
    queue,
    payload.vaultId,
    payload.itemId,
  );
  return queue.enqueue({
    type: "generateCover",
    payload,
    idempotencyKey: generateCoverIdempotencyKey(payload),
  });
}
