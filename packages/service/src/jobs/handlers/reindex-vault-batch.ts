import {
  reconcileIndexFolderPrefixFromFilesystem,
  syncIndexItemsFromFilesystem,
  type VaultContext,
} from "@collector/core";
import {
  JOB_PRIORITY_BULK,
  reindexVaultBatchJobType,
  type ReindexVaultBatchJobPayload,
} from "@collector/shared";
import { createHash } from "node:crypto";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

function failFromReport(
  label: string,
  report: { errors: Array<{ message: string }> },
): JobHandlerResult | null {
  if (report.errors.length === 0) {
    return null;
  }
  const summary = report.errors.map((e) => e.message).join("; ");
  return {
    status: "fail",
    retryable: true,
    error: `${label}: ${summary}`,
  };
}

function batchIdempotencyKey(
  vaultId: string,
  itemIds: string[],
  folderPaths: string[],
): string {
  const digest = createHash("sha256")
    .update([...itemIds].sort().join("\0"))
    .update("\n")
    .update([...folderPaths].sort().join("\0"))
    .digest("hex")
    .slice(0, 16);
  return `reindexVaultBatch:${vaultId}:${digest}`;
}

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
      const failure = failFromReport("folder prefix index sync failed", report);
      if (failure) {
        return failure;
      }
    }

    if (itemIds.length > 0) {
      const report = await syncIndexItemsFromFilesystem(
        ctx,
        vaultPath,
        vaultId,
        itemIds,
      );
      const failure = failFromReport("targeted index sync failed", report);
      if (failure) {
        return failure;
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
  return queue.enqueue({
    type: "reindexVaultBatch",
    payload,
    priority: JOB_PRIORITY_BULK,
    idempotencyKey: batchIdempotencyKey(
      payload.vaultId,
      payload.itemIds,
      payload.folderPaths,
    ),
  });
}
