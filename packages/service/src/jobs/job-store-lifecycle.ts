import type { SqlMigrator } from "@collector/db";
import { VAULT_MUTATING_BULK_JOB_TYPE_IDS } from "@collector/shared";
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

  /** Return a single claimed (running) job to pending — e.g. stop after claim, before execute. */
  async function releaseClaim(id: string, nowIso: string): Promise<void> {
    const changes = await db.execute(
      `UPDATE jobs
       SET status = 'pending', started_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'running'`,
      [nowIso, id],
    );
    if (changes === 0) {
      throw new Error(`releaseClaim: job not running: ${id}`);
    }
  }

  async function claimNext(
    nowIso: string,
    options?: { skipLowPriorityVaultMutators?: boolean },
  ): Promise<JobRow | null> {
    const skipLowPriorityVaultMutators =
      options?.skipLowPriorityVaultMutators === true;
    const excludeTypes = skipLowPriorityVaultMutators
      ? VAULT_MUTATING_BULK_JOB_TYPE_IDS
      : [];
    const params: unknown[] = [nowIso];
    let typeFilter = "";
    if (excludeTypes.length > 0) {
      // Exclude by type only — priority must not open a second bulk-mutator slot.
      typeFilter = ` AND type NOT IN (${excludeTypes.map(() => "?").join(", ")})`;
      params.push(...excludeTypes);
    }
    const candidates = await db.select<JobRow>(
      `SELECT * FROM jobs
       WHERE status = 'pending' AND available_at <= ?${typeFilter}
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`,
      params,
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
    releaseClaim,
    claimNext,
    markSucceeded,
    markFailed,
    scheduleRetry,
  };
}
