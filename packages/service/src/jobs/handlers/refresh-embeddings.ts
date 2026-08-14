import {
  refreshEmbeddingsJobType,
  type RefreshEmbeddingsJobPayload,
} from "@collector/shared";
import { createHash } from "node:crypto";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

export function createRefreshEmbeddingsHandler(deps: {
  refresh: (
    inputs: RefreshEmbeddingsJobPayload["inputs"],
  ) => Promise<void>;
}): TypedJobHandler<typeof refreshEmbeddingsJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    await deps.refresh(job.payload.inputs);
    return { status: "ok" };
  };
}

export function enqueueRefreshEmbeddings(
  queue: JobQueue,
  payload: RefreshEmbeddingsJobPayload,
): Promise<EnqueueResult> {
  const digest = createHash("sha256")
    .update(
      payload.inputs
        .map((input) => `${input.itemId}:${input.contentRevision}`)
        .sort()
        .join("\0"),
    )
    .digest("hex")
    .slice(0, 16);
  return queue.enqueue({
    type: "refreshEmbeddings",
    payload,
    idempotencyKey: `refreshEmbeddings:${payload.vaultId}:${digest}`,
  });
}
