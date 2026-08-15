import type { SqlMigrator } from "@collector/db";
import type { JobRow } from "./job-store-types.js";
import type { JobStoreQuery } from "./job-store-query.js";

export function createJobStoreLifecycle(
  db: SqlMigrator,
  getJob: JobStoreQuery["getJob"],
) {
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
    reclaimRunning,
    claimNext,
    markSucceeded,
    markFailed,
    scheduleRetry,
  };
}
