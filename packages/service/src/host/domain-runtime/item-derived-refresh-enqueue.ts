import type { ItemDerivedRefreshJobPayload } from "@collector/shared";
import type { JobQueue } from "../../jobs/job-queue.js";
import { enqueueItemDerivedRefresh } from "../../jobs/handlers/item-derived-refresh.js";
import {
  reportEnqueueFailure,
  type JobPermanentFailureStore,
} from "../../job-permanent-failure.js";

export type ItemDerivedRefreshEnqueueDeps = {
  requireJobs: () => JobQueue;
  jobPermanentFailure: JobPermanentFailureStore;
};

/** Enqueue itemDerivedRefresh with the same permanent-failure path as CRUD (#776). */
export async function enqueueItemDerivedRefreshWithFailureReporting(
  deps: ItemDerivedRefreshEnqueueDeps,
  input: ItemDerivedRefreshJobPayload,
): Promise<void> {
  try {
    await enqueueItemDerivedRefresh(deps.requireJobs(), input);
  } catch (error) {
    reportEnqueueFailure(deps.jobPermanentFailure, "itemDerivedRefresh", error);
  }
}
