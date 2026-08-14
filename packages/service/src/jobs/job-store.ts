import type { JobStats, JobStatusCounts } from "@collector/api";
import type { SqlMigrator } from "@collector/db";

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type { JobStats, JobStatusCounts };

export interface JobRow {
  id: string;
  type: string;
  payload_json: string;
  status: JobStatus;
  priority: number;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
  available_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function emptyStatusCounts(): JobStatusCounts {
  return {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
}

export interface EnqueueRecord {
  id: string;
  type: string;
  payloadJson: string;
  priority: number;
  idempotencyKey: string | null;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
}

export function createJobStore(db: SqlMigrator) {
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

  async function reclaimRunning(nowIso: string): Promise<number> {
    return db.execute(
      `UPDATE jobs
       SET status = 'pending', started_at = NULL, updated_at = ?
       WHERE status = 'running'`,
      [nowIso],
    );
  }

  async function claimNext(nowIso: string): Promise<JobRow | null> {
    const candidates = await db.select<JobRow>(
      `SELECT * FROM jobs
       WHERE status = 'pending' AND available_at <= ?
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`,
      [nowIso],
    );
    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }
    const changes = await db.execute(
      `UPDATE jobs
       SET status = 'running', started_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      [nowIso, nowIso, candidate.id],
    );
    if (changes === 0) {
      return null;
    }
    return {
      ...candidate,
      status: "running",
      started_at: nowIso,
      updated_at: nowIso,
    };
  }

  async function markSucceeded(id: string, nowIso: string): Promise<void> {
    await db.execute(
      `UPDATE jobs
       SET status = 'succeeded', finished_at = ?, updated_at = ?, last_error = NULL
       WHERE id = ?`,
      [nowIso, nowIso, id],
    );
  }

  async function markFailed(
    id: string,
    nowIso: string,
    error: string,
  ): Promise<void> {
    await db.execute(
      `UPDATE jobs
       SET status = 'failed', finished_at = ?, updated_at = ?, last_error = ?
       WHERE id = ?`,
      [nowIso, nowIso, error, id],
    );
  }

  async function scheduleRetry(input: {
    id: string;
    nowIso: string;
    availableAt: string;
    error: string;
    burnAttempt: boolean;
  }): Promise<{ status: "pending" | "failed"; attempts: number }> {
    const job = await getJob(input.id);
    if (!job) {
      throw new Error(`job not found: ${input.id}`);
    }
    const attempts = input.burnAttempt ? job.attempts + 1 : job.attempts;
    if (input.burnAttempt && attempts >= job.max_attempts) {
      await db.execute(
        `UPDATE jobs
         SET status = 'failed', attempts = ?, finished_at = ?, updated_at = ?, last_error = ?
         WHERE id = ?`,
        [attempts, input.nowIso, input.nowIso, input.error, input.id],
      );
      return { status: "failed", attempts };
    }
    await db.execute(
      `UPDATE jobs
       SET status = 'pending', attempts = ?, available_at = ?, started_at = NULL,
           updated_at = ?, last_error = ?, finished_at = NULL
       WHERE id = ?`,
      [
        attempts,
        input.availableAt,
        input.nowIso,
        input.error,
        input.id,
      ],
    );
    return { status: "pending", attempts };
  }

  return {
    findActiveByIdempotencyKey,
    insertJob,
    getJob,
    cancelPending,
    stats,
    reclaimRunning,
    claimNext,
    markSucceeded,
    markFailed,
    scheduleRetry,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
