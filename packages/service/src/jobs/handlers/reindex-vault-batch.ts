import {
  reconcileIndexFolderPrefixFromFilesystem,
  syncIndexItemsFromFilesystem,
  type VaultContext,
} from "@collector/core";
import {
  reindexVaultBatchJobType,
  type ReindexVaultBatchJobPayload,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export function createReindexVaultBatchHandler(deps: {
  getContext: () => VaultContext;
  onItemsSynced: (vaultId: string) => void;
  onWatchApplied?: (vaultId: string, vaultPath: string) => void;
}): TypedJobHandler<typeof reindexVaultBatchJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const { vaultId, vaultPath, itemIds, folderPaths } = job.payload;
    const ctx = deps.getContext();

    for (const folderPath of folderPaths) {
      const report = await reconcileIndexFolderPrefixFromFilesystem(
        ctx,
        vaultPath,
        vaultId,
        folderPath,
      );
      if (report.errors.length > 0) {
        const summary = report.errors.map((e) => e.message).join("; ");
        return {
          status: "fail",
          retryable: true,
          error: `folder prefix index sync failed: ${summary}`,
        };
      }
    }

    if (itemIds.length > 0) {
      const report = await syncIndexItemsFromFilesystem(
        ctx,
        vaultPath,
        vaultId,
        itemIds,
      );
      if (report.errors.length > 0) {
        const summary = report.errors.map((e) => e.message).join("; ");
        return {
          status: "fail",
          retryable: true,
          error: `targeted index sync failed: ${summary}`,
        };
      }
    }

    deps.onItemsSynced(vaultId);
    deps.onWatchApplied?.(vaultId, vaultPath);
    return { status: "ok" };
  };
}

export function enqueueReindexVaultBatch(
  queue: JobQueue,
  payload: ReindexVaultBatchJobPayload,
): Promise<EnqueueResult> {
  const itemKey = [...payload.itemIds].sort().join(",");
  const folderKey = [...payload.folderPaths].sort().join(",");
  return queue.enqueue({
    type: "reindexVaultBatch",
    payload,
    idempotencyKey: `reindexVaultBatch:${payload.vaultId}:${itemKey}:${folderKey}`,
  });
}
