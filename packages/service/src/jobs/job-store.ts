import type { SqlMigrator } from "@collector/db";
import { createJobStoreLifecycle } from "./job-store-lifecycle.js";
import { createJobStoreQuery } from "./job-store-query.js";

export type {
  EnqueueRecord,
  JobRow,
  JobStats,
  JobStatus,
  JobStatusCounts,
} from "./job-store-types.js";

export function createJobStore(db: SqlMigrator) {
  const query = createJobStoreQuery(db);
  const lifecycle = createJobStoreLifecycle(db, query.getJob);
  return {
    ...query,
    ...lifecycle,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
