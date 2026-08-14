import {
  refreshEmbeddingsJobType,
  type RefreshEmbeddingsJobPayload,
} from "@collector/shared";
import type { ItemEmbeddingRefreshInput } from "@collector/core";
import { createHash } from "node:crypto";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export function createRefreshEmbeddingsHandler(deps: {
  refresh: (inputs: ItemEmbeddingRefreshInput[]) => Promise<void>;
  loadRefreshInputs: (
    vaultId: string,
    itemIds: string[],
  ) => Promise<ItemEmbeddingRefreshInput[]>;
}): TypedJobHandler<typeof refreshEmbeddingsJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const inputs = await deps.loadRefreshInputs(
      job.payload.vaultId,
      job.payload.itemIds,
    );
    if (inputs.length === 0) {
      return { status: "ok" };
    }
    await deps.refresh(inputs);
    return { status: "ok" };
  };
}

export function enqueueRefreshEmbeddings(
  queue: JobQueue,
  payload: RefreshEmbeddingsJobPayload,
): Promise<EnqueueResult> {
  const digest = createHash("sha256")
    .update([...payload.itemIds].sort().join("\0"))
    .digest("hex")
    .slice(0, 16);
  return queue.enqueue({
    type: "refreshEmbeddings",
    payload,
    idempotencyKey: `refreshEmbeddings:${payload.vaultId}:${digest}`,
  });
}
