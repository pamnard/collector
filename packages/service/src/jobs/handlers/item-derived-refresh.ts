import {
  itemDerivedRefreshJobType,
  type ItemDerivedRefreshJobPayload,
} from "@collector/shared";
import { upsertItemIndexFromVault, type VaultContext } from "@collector/core";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export function createItemDerivedRefreshHandler(deps: {
  getContext: () => VaultContext;
}): TypedJobHandler<typeof itemDerivedRefreshJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const { vaultId, vaultPath, itemId, contentRevision } = job.payload;
    await upsertItemIndexFromVault(
      deps.getContext(),
      vaultPath,
      vaultId,
      itemId,
      contentRevision,
    );
    return { status: "ok" };
  };
}

export function enqueueItemDerivedRefresh(
  queue: JobQueue,
  payload: ItemDerivedRefreshJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "itemDerivedRefresh",
    payload,
    idempotencyKey: `itemDerivedRefresh:${payload.vaultId}:${payload.itemId}:${payload.contentRevision}`,
  });
}
