import type { JobStats } from "@collector/api";
import type { SqlMigrator } from "@collector/db";
import {
  emptyStatusCounts,
  type EnqueueRecord,
  type JobRow,
  type JobStatus,
} from "./job-store-types.js";

export function createJobStoreQuery(db: SqlMigrator) {
  async function findActiveByIdempotencyKey(
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
  }

  /**
   * Latest job for an idempotency key (any status). Used by opt-in waitDerived
   * so a fast-finishing derived job is still findable after terminal (#770).
   */
  async function findByIdempotencyKey(key: string): Promise<JobRow | null> {
    const rows = await db.select<JobRow>(
      `SELECT * FROM jobs
       WHERE idempotency_key = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }

  async function findLatestByIdempotencyKeyPrefix(
    prefix: string,
  ): Promise<JobRow | null> {
    const rows = await db.select<JobRow>(
      `SELECT * FROM jobs
       WHERE idempotency_key LIKE ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [`${prefix}%`],
    );
    return rows[0] ?? null;
  }

  async function insertJob(record: EnqueueRecord): Promise<void> {
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
  }

  async function getJob(id: string): Promise<JobRow | null> {
    const rows = await db.select<JobRow>(`SELECT * FROM jobs WHERE id = ?`, [
      id,
    ]);
    return rows[0] ?? null;
  }

  async function cancelPending(id: string, nowIso: string): Promise<boolean> {
    const changes = await db.execute(
      `UPDATE jobs
       SET status = 'cancelled', updated_at = ?, finished_at = ?
       WHERE id = ? AND status = 'pending'`,
      [nowIso, nowIso, id],
    );
    return changes > 0;
  }

  async function stats(): Promise<JobStats> {
    const rows = await db.select<{
      status: JobStatus;
      type: string;
      n: number;
    }>(`SELECT status, type, COUNT(*) AS n FROM jobs GROUP BY status, type`);
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

  return {
    findActiveByIdempotencyKey,
    findByIdempotencyKey,
    findLatestByIdempotencyKeyPrefix,
    insertJob,
    getJob,
    cancelPending,
    stats,
  };
}

export type JobStoreQuery = ReturnType<typeof createJobStoreQuery>;
