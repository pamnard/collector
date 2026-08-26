import type { ItemDerivedRefreshJobPayload } from "@collector/shared";
import { enqueueItemDerivedRefresh } from "../../jobs/handlers/item-derived-refresh.js";
import {
  enqueueJobWithFailureReporting,
  type JobPermanentFailureStore,
} from "../../job-permanent-failure.js";
import type { JobQueue } from "../../jobs/job-queue.js";

export type ItemDerivedRefreshEnqueueDeps = {
  requireJobs: () => JobQueue;
  jobPermanentFailure: JobPermanentFailureStore;
};

export async function enqueueItemDerivedRefreshWithFailureReporting(
  deps: ItemDerivedRefreshEnqueueDeps,
  input: ItemDerivedRefreshJobPayload,
): Promise<void> {
  await enqueueJobWithFailureReporting(
    deps,
    "itemDerivedRefresh",
    (queue) => enqueueItemDerivedRefresh(queue, input),
  );
}
