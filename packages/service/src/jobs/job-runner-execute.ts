import type { JobRegistry } from "./job-registry.js";
import type { JobRow, JobStore } from "./job-store.js";
import type { ApplyRetry } from "./job-runner-retry.js";
import type { ReportPermanentFailure } from "./job-runner-failure.js";
import {
  decideExecuteSettlement,
  jobErrorMessage,
  parseExecutePayload,
  runHandlerWithTimeout,
} from "./job-runner-execute-phases.js";

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

    const parsed = parseExecutePayload(job, registry);
    if (!parsed.ok) {
      await store.markFailed(job.id, nowIso(), parsed.error);
      reportPermanentFailure(job, parsed.error, job.attempts);
      return;
    }

    const entry = registry.requireEntry(job.type);
    // Per-type timeout (e.g. importFolder hours) overrides the queue default.
    const effectiveTimeoutMs = entry.type.timeoutMs ?? timeoutMs;

    let result;
    try {
      result = await runHandlerWithTimeout({
        timeoutMs: effectiveTimeoutMs,
        handler: () =>
          entry.handler({
            id: job.id,
            type: job.type,
            payload: parsed.payload,
            attempts: job.attempts,
          }),
      });
    } catch (err) {
      await applyRetry(job, jobErrorMessage(err), {
        availableAt: nowIso(),
        burnAttempt: true,
      });
      return;
    }

    const decision = decideExecuteSettlement(result);
    if (decision.action === "succeeded") {
      await store.markSucceeded(job.id, nowIso());
      return;
    }
    if (decision.action === "permanent_fail") {
      await store.markFailed(job.id, nowIso(), decision.error);
      reportPermanentFailure(job, decision.error, job.attempts);
      return;
    }

    const availableAt =
      decision.availableAtOffsetMs === null
        ? nowIso()
        : new Date(now().getTime() + decision.availableAtOffsetMs).toISOString();
    await applyRetry(job, decision.error, {
      availableAt,
      burnAttempt: decision.burnAttempt,
      ...(decision.availableAtOffsetMs !== null
        ? { retryAfterMs: decision.availableAtOffsetMs }
        : {}),
    });
  };
}

export type ExecuteJob = ReturnType<typeof createExecuteJob>;
