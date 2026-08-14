import type { SyncNowResult } from "@collector/api";
import {
  syncPluginPullJobType,
  type SyncPluginPullJobPayload,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";

const pullResultsByJobId = new Map<string, SyncNowResult>();

export function takeSyncPluginPullResult(jobId: string): SyncNowResult | null {
  const result = pullResultsByJobId.get(jobId) ?? null;
  pullResultsByJobId.delete(jobId);
  return result;
}

export function createSyncPluginPullHandler(deps: {
  syncNow: (pluginId: string) => Promise<SyncNowResult>;
}): TypedJobHandler<typeof syncPluginPullJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const result = await deps.syncNow(job.payload.pluginId);
    pullResultsByJobId.set(job.id, result);
    return { status: "ok" };
  };
}

export function enqueueSyncPluginPull(
  queue: JobQueue,
  payload: SyncPluginPullJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "syncPluginPull",
    payload,
    idempotencyKey: `syncPluginPull:${payload.pluginId}`,
  });
}

export async function waitForJobTerminal(
  queue: JobQueue,
  jobId: string,
  timeoutMs = 120_000,
): Promise<"succeeded" | "failed" | "cancelled"> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await queue.getJob(jobId);
    if (!row) {
      throw new Error(`job not found: ${jobId}`);
    }
    if (
      row.status === "succeeded" ||
      row.status === "failed" ||
      row.status === "cancelled"
    ) {
      return row.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job wait timed out: ${jobId}`);
}
