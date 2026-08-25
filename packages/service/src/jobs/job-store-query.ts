import type { SqlMigrator } from "@collector/db";
import {
  createCancelPending,
  createFindActiveByIdempotencyKey,
  createFindByIdempotencyKey,
  createFindLatestByIdempotencyKeyPrefix,
  createGetJob,
  createInsertJob,
  createJobStatsQuery,
} from "./job-store-query-builders.js";

export function createJobStoreQuery(db: SqlMigrator) {
  return {
    findActiveByIdempotencyKey: createFindActiveByIdempotencyKey(db),
    findByIdempotencyKey: createFindByIdempotencyKey(db),
    findLatestByIdempotencyKeyPrefix: createFindLatestByIdempotencyKeyPrefix(db),
    insertJob: createInsertJob(db),
    getJob: createGetJob(db),
    cancelPending: createCancelPending(db),
    stats: createJobStatsQuery(db),
  };
}

export type JobStoreQuery = ReturnType<typeof createJobStoreQuery>;
