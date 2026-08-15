import type { SyncNowResult } from "@collector/api";
import {
  syncPluginPullJobType,
  type SyncPluginPullJobPayload,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";
import { createJobResultMailbox } from "../job-result-mailbox.js";
import {
  isTelegramConnectivityError,
  isTelegramConnectivityErrorMessage,
} from "../../plugins/telegram/telegram-bot-api.js";

const pullResults = createJobResultMailbox<SyncNowResult>();

export function takeSyncPluginPullResult(jobId: string): SyncNowResult | null {
  return pullResults.take(jobId);
}

export function createSyncPluginPullHandler(deps: {
  syncNow: (pluginId: string) => Promise<SyncNowResult>;
}): TypedJobHandler<typeof syncPluginPullJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    try {
      const result = await deps.syncNow(job.payload.pluginId);
      pullResults.set(job.id, result);
      return { status: "ok" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        isTelegramConnectivityError(error) ||
        isTelegramConnectivityErrorMessage(message)
      ) {
        console.info("[jobs] syncPluginPull skipped: telegram unreachable", {
          jobId: job.id,
          error: message,
        });
        pullResults.set(job.id, { importedCount: 0, itemIds: [] });
        return { status: "ok" };
      }
      throw error;
    }
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

export { waitForJobTerminal } from "../job-wait.js";
