import type { JobRow, JobStore } from "./job-store.js";
import type { ReportPermanentFailure } from "./job-runner-failure.js";

export function createApplyRetry(deps: {
  store: JobStore;
  now: () => Date;
  reportPermanentFailure: ReportPermanentFailure;
}) {
  const { store, now, reportPermanentFailure } = deps;

  return async function applyRetry(
    job: JobRow,
    error: string,
    input: {
      availableAt: string;
      burnAttempt: boolean;
      retryAfterMs?: number;
    },
  ): Promise<void> {
    const outcome = await store.scheduleRetry({
      id: job.id,
      nowIso: now().toISOString(),
      availableAt: input.availableAt,
      error,
      burnAttempt: input.burnAttempt,
    });
    if (outcome.status === "failed") {
      reportPermanentFailure(job, error, outcome.attempts);
      return;
    }
    console.info("[jobs] retry scheduled", {
      jobId: job.id,
      type: job.type,
      error,
      ...(input.retryAfterMs !== undefined
        ? { retryAfterMs: input.retryAfterMs }
        : {}),
    });
  };
}

export type ApplyRetry = ReturnType<typeof createApplyRetry>;
