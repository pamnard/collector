import type { JobStats } from "@collector/api";
import type { SqlMigrator } from "@collector/db";
import {
  emptyStatusCounts,
  type EnqueueRecord,
  type JobRow,
  type JobStatus,
} from "./job-store-types.js";

/** Pure aggregation for {@link createJobStoreQuery} stats(). */
export function buildJobStatsFromRows(
  rows: ReadonlyArray<{ status: JobStatus; type: string; n: number }>,
): JobStats {
  const out: JobStats = {
    ...emptyStatusCounts(),
    byType: {},
  };
  for (const row of rows) {
    const n = Number(row.n);
    out[row.status] += n;
    const typeCounts = out.byType[row.type] ?? emptyStatusCounts();
    typeCounts[row.status] += n;
    out.byType[row.type] = typeCounts;
  }
  return out;
}

export function createFindActiveByIdempotencyKey(db: SqlMigrator) {
  return async function findActiveByIdempotencyKey(
    key: string,
  ): Promise<JobRow | null> {
    const rows = await db.select<JobRow>(
      `SELECT * FROM jobs
       WHERE idempotency_key = ?
         AND status IN ('pending', 'running')
       LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  };
}

/**
 * Latest job for an idempotency key (any status). Used by opt-in waitDerived
 * so a fast-finishing derived job is still findable after terminal (#770).
 */
export function createFindByIdempotencyKey(db: SqlMigrator) {
  return async function findByIdempotencyKey(
    key: string,
  ): Promise<JobRow | null> {
    const rows = await db.select<JobRow>(
      `SELECT * FROM jobs
       WHERE idempotency_key = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  };
}

export function createFindLatestByIdempotencyKeyPrefix(db: SqlMigrator) {
  return async function findLatestByIdempotencyKeyPrefix(
    prefix: string,
  ): Promise<JobRow | null> {
    const rows = await db.select<JobRow>(
      `SELECT * FROM jobs
       WHERE idempotency_key LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC
       LIMIT 1`,
      [`${escapeLikePrefix(prefix)}%`],
    );
    return rows[0] ?? null;
  };
}

export function createInsertJob(db: SqlMigrator) {
  return async function insertJob(record: EnqueueRecord): Promise<void> {
    await db.execute(
      `INSERT INTO jobs (
         id, type, payload_json, status, priority, idempotency_key,
         attempts, max_attempts, available_at, started_at, finished_at,
         last_error, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, 0, ?, ?, NULL, NULL, NULL, ?, ?)`,
      [
        record.id,
        record.type,
        record.payloadJson,
        record.priority,
        record.idempotencyKey,
        record.maxAttempts,
        record.availableAt,
        record.createdAt,
        record.createdAt,
      ],
    );
  };
}

export function createGetJob(db: SqlMigrator) {
  return async function getJob(id: string): Promise<JobRow | null> {
    const rows = await db.select<JobRow>(`SELECT * FROM jobs WHERE id = ?`, [
      id,
    ]);
    return rows[0] ?? null;
  };
}

export function createCancelPending(db: SqlMigrator) {
  return async function cancelPending(
    id: string,
    nowIso: string,
  ): Promise<boolean> {
    const changes = await db.execute(
      `UPDATE jobs
       SET status = 'cancelled', updated_at = ?, finished_at = ?
       WHERE id = ? AND status = 'pending'`,
      [nowIso, nowIso, id],
    );
    return changes > 0;
  };
}

/**
 * Cancel all pending jobs whose idempotency key starts with `prefix`.
 * Used to supersede stale generateCover work for one item (#875).
 */
export function createCancelPendingByIdempotencyKeyPrefix(db: SqlMigrator) {
  return async function cancelPendingByIdempotencyKeyPrefix(
    prefix: string,
    nowIso: string,
  ): Promise<number> {
    return db.execute(
      `UPDATE jobs
       SET status = 'cancelled', updated_at = ?, finished_at = ?
       WHERE status = 'pending'
         AND idempotency_key LIKE ? ESCAPE '\\'`,
      [nowIso, nowIso, `${escapeLikePrefix(prefix)}%`],
    );
  };
}

/** Escape LIKE wildcards so a literal prefix match cannot over-cancel. */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function createJobStatsQuery(db: SqlMigrator) {
  return async function stats(): Promise<JobStats> {
    const rows = await db.select<{
      status: JobStatus;
      type: string;
      n: number;
    }>(`SELECT status, type, COUNT(*) AS n FROM jobs GROUP BY status, type`);
    return buildJobStatsFromRows(rows);
  };
}
