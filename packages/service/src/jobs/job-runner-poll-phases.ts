/**
 * Pure poll-loop helpers for {@link createJobPoll} (#793).
 * Phases: claim capacity → run tracking → settle schedule → retry wake.
 */

export function canClaimMore(input: {
  isStopped: boolean;
  inFlightSize: number;
  concurrency: number;
}): boolean {
  return !input.isStopped && input.inFlightSize < input.concurrency;
}

/** Vault-mutating bulk jobs share one in-flight slot. */
export function shouldSkipVaultMutatingBulk(
  vaultMutatingBulkJobsInFlight: number,
): boolean {
  return vaultMutatingBulkJobsInFlight >= 1;
}

export type PollSettleAction =
  | { kind: "none" }
  | { kind: "immediate" }
  | { kind: "heartbeat"; delayMs: number };

/**
 * After a claim/run tick, decide the next schedule.
 * Immediate when we claimed and still have capacity; heartbeat while idle.
 */
export function settlePollTick(input: {
  isStopped: boolean;
  claimed: number;
  inFlightSize: number;
  concurrency: number;
  pollIntervalMs: number;
}): PollSettleAction {
  if (input.isStopped) {
    return { kind: "none" };
  }
  if (input.claimed > 0 && input.inFlightSize < input.concurrency) {
    return { kind: "immediate" };
  }
  if (input.inFlightSize === 0) {
    return { kind: "heartbeat", delayMs: input.pollIntervalMs };
  }
  return { kind: "none" };
}

/** Job settled → wake poll to fill free slots (unless stopped). */
export function shouldRetryPollAfterJobSettled(isStopped: boolean): boolean {
  return !isStopped;
}
