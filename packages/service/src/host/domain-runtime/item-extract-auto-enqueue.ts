import type { ItemExtractAutoJobPayload } from "@collector/shared";
import { enqueueItemExtractAuto } from "../../jobs/handlers/item-extract-auto.js";
import {
  enqueueJobWithFailureReporting,
  type JobPermanentFailureStore,
} from "../../job-permanent-failure.js";
import type { JobQueue } from "../../jobs/job-queue.js";

export type ItemExtractAutoEnqueueDeps = {
  requireJobs: () => JobQueue;
  jobPermanentFailure: JobPermanentFailureStore;
};

export async function enqueueItemExtractAutoWithFailureReporting(
  deps: ItemExtractAutoEnqueueDeps,
  input: ItemExtractAutoJobPayload,
): Promise<void> {
  await enqueueJobWithFailureReporting(
    deps,
    "itemExtractAuto",
    (queue) => enqueueItemExtractAuto(queue, input),
  );
}
