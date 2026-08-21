import type { JobRegistry } from "./job-registry.js";
import type { JobHandlerResult } from "./job-types.js";
import type { JobRow, JobStore } from "./job-store.js";
import type { ApplyRetry } from "./job-runner-retry.js";
import type { ReportPermanentFailure } from "./job-runner-failure.js";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createExecuteJob(deps: {
  store: JobStore;
  registry: JobRegistry;
  timeoutMs: number;
  now: () => Date;
  applyRetry: ApplyRetry;
  reportPermanentFailure: ReportPermanentFailure;
}) {
  const {
    store,
    registry,
    timeoutMs,
    now,
    applyRetry,
    reportPermanentFailure,
  } = deps;

  return async function executeJob(job: JobRow): Promise<void> {
    const nowIso = () => now().toISOString();
    if (!registry.has(job.type)) {
      const error = `no handler registered for job type: ${job.type}`;
      await store.markFailed(job.id, nowIso(), error);
      reportPermanentFailure(job, error, job.attempts);
      return;
    }
    const entry = registry.requireEntry(job.type);

    let raw: unknown;
    try {
      raw = JSON.parse(job.payload_json) as unknown;
    } catch (err) {
      const error = `invalid payload_json: ${errMsg(err)}`;
      await store.markFailed(job.id, nowIso(), error);
      reportPermanentFailure(job, error, job.attempts);
      return;
    }

    let payload: unknown;
    try {
      payload = registry.parsePayload(job.type, raw);
    } catch (err) {
      const error = `invalid job payload: ${errMsg(err)}`;
      await store.markFailed(job.id, nowIso(), error);
      reportPermanentFailure(job, error, job.attempts);
      return;
    }

    // Per-type timeout (e.g. importFolder hours) overrides the queue default.
    const effectiveTimeoutMs = entry.type.timeoutMs ?? timeoutMs;

    let result: JobHandlerResult;
    try {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      result = await Promise.race([
        entry
          .handler({
            id: job.id,
            type: job.type,
            payload,
            attempts: job.attempts,
          })
          .finally(() => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }),
        new Promise<JobHandlerResult>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(`job timed out after ${effectiveTimeoutMs}ms`),
            );
          }, effectiveTimeoutMs);
        }),
      ]);
    } catch (err) {
      await applyRetry(job, errMsg(err), {
        availableAt: nowIso(),
        burnAttempt: true,
      });
      return;
    }

    if (result.status === "ok") {
      await store.markSucceeded(job.id, nowIso());
      return;
    }

    if (!result.retryable) {
      await store.markFailed(job.id, nowIso(), result.error);
      reportPermanentFailure(job, result.error, job.attempts);
      return;
    }

    if (result.retryAfterMs !== undefined) {
      const availableAt = new Date(
        now().getTime() + result.retryAfterMs,
      ).toISOString();
      await applyRetry(job, result.error, {
        availableAt,
        burnAttempt: false,
        retryAfterMs: result.retryAfterMs,
      });
      return;
    }

    await applyRetry(job, result.error, {
      availableAt: nowIso(),
      burnAttempt: true,
    });
  };
}

export type ExecuteJob = ReturnType<typeof createExecuteJob>;
