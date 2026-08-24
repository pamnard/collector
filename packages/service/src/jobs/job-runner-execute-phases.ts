import type { JobHandlerResult } from "./job-types.js";
import type { JobRegistry } from "./job-registry.js";
import type { JobRow } from "./job-store.js";

export function jobErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type ParsedExecutePayload =
  | { ok: true; payload: unknown }
  | { ok: false; error: string };

/**
 * Claim-phase for execute: handler presence + payload_json + typed parse.
 * Permanent-fail errors are returned; caller marks failed + reports.
 */
export function parseExecutePayload(
  job: JobRow,
  registry: Pick<JobRegistry, "has" | "parsePayload">,
): ParsedExecutePayload {
  if (!registry.has(job.type)) {
    return {
      ok: false,
      error: `no handler registered for job type: ${job.type}`,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(job.payload_json) as unknown;
  } catch (err) {
    return {
      ok: false,
      error: `invalid payload_json: ${jobErrorMessage(err)}`,
    };
  }

  try {
    return { ok: true, payload: registry.parsePayload(job.type, raw) };
  } catch (err) {
    return {
      ok: false,
      error: `invalid job payload: ${jobErrorMessage(err)}`,
    };
  }
}

export function isOkHandlerResult(
  result: JobHandlerResult,
): result is { status: "ok" } {
  return result.status === "ok";
}

export function isPermanentFailResult(
  result: JobHandlerResult,
): result is { status: "fail"; retryable: false; error: string } {
  return result.status === "fail" && !result.retryable;
}

export function isRetryableFailResult(
  result: JobHandlerResult,
): result is {
  status: "fail";
  retryable: true;
  error: string;
  retryAfterMs?: number;
} {
  return result.status === "fail" && result.retryable;
}

export function retryAfterMsFromResult(
  result: JobHandlerResult,
): number | undefined {
  if (!isRetryableFailResult(result)) {
    return undefined;
  }
  return result.retryAfterMs;
}

export type ExecuteSettleDecision =
  | { action: "succeeded" }
  | { action: "permanent_fail"; error: string }
  | {
      action: "retry";
      error: string;
      burnAttempt: boolean;
      /** Absolute ISO available_at; null means use now. */
      availableAtOffsetMs: number | null;
    };

/** Settle / retry decision from a completed handler result. */
export function decideExecuteSettlement(
  result: JobHandlerResult,
): ExecuteSettleDecision {
  if (isOkHandlerResult(result)) {
    return { action: "succeeded" };
  }
  if (isPermanentFailResult(result)) {
    return { action: "permanent_fail", error: result.error };
  }
  if (!isRetryableFailResult(result)) {
    throw new Error(`unexpected job handler result: ${JSON.stringify(result)}`);
  }
  const retryAfterMs = result.retryAfterMs;
  if (retryAfterMs !== undefined) {
    return {
      action: "retry",
      error: result.error,
      burnAttempt: false,
      availableAtOffsetMs: retryAfterMs,
    };
  }
  return {
    action: "retry",
    error: result.error,
    burnAttempt: true,
    availableAtOffsetMs: null,
  };
}

export async function runHandlerWithTimeout(input: {
  handler: () => Promise<JobHandlerResult>;
  timeoutMs: number;
}): Promise<JobHandlerResult> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    input.handler().finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    new Promise<JobHandlerResult>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`job timed out after ${input.timeoutMs}ms`));
      }, input.timeoutMs);
    }),
  ]);
}
