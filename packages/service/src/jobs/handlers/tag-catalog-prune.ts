import {
  runTagCatalogPrune,
  type VaultContext,
} from "@collector/core";
import {
  tagCatalogPruneFullIdempotencyKey,
  tagCatalogPruneJobType,
  type TagCatalogPruneJobPayload,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export function createTagCatalogPruneHandler(deps: {
  getContext: () => VaultContext;
}): TypedJobHandler<typeof tagCatalogPruneJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const { vaultId, vaultPath, candidateTagIds } = job.payload;
    await runTagCatalogPrune(
      deps.getContext(),
      vaultPath,
      vaultId,
      candidateTagIds,
    );
    return { status: "ok" };
  };
}

export function enqueueTagCatalogPrune(
  queue: JobQueue,
  payload: TagCatalogPruneJobPayload,
): Promise<EnqueueResult> {
  const isFull = payload.candidateTagIds === undefined;
  return queue.enqueue({
    type: tagCatalogPruneJobType.id,
    payload,
    idempotencyKey: isFull
      ? tagCatalogPruneFullIdempotencyKey(payload.vaultId)
      : undefined,
  });
}
