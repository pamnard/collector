import type { JobQueue } from "./job-queue.js";
import type { JobStatus } from "./job-store.js";

export type TerminalJobStatus = Extract<
  JobStatus,
  "succeeded" | "failed" | "cancelled"
>;

const TERMINAL: ReadonlySet<JobStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

/** Poll until the job leaves pending/running. Backoff reduces SQLite chatter. */
export async function waitForJobTerminal(
  queue: JobQueue,
  jobId: string,
  timeoutMs = 120_000,
): Promise<TerminalJobStatus> {
  const startedAt = Date.now();
  let delayMs = 25;
  while (Date.now() - startedAt < timeoutMs) {
    const row = await queue.getJob(jobId);
    if (!row) {
      throw new Error(`job not found: ${jobId}`);
    }
    if (TERMINAL.has(row.status)) {
      return row.status as TerminalJobStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 500);
  }
  throw new Error(`job wait timed out: ${jobId}`);
}

export async function enqueueAndAwaitResult<T>(options: {
  queue: JobQueue;
  enqueue: () => Promise<{ id: string }>;
  takeResult: (jobId: string) => T | null;
  label: string;
  /** When true, return takeResult even if the job status is failed. */
  acceptFailed?: boolean;
}): Promise<T> {
  const { id } = await options.enqueue();
  const terminal = await waitForJobTerminal(options.queue, id);
  const result = options.takeResult(id);
  if (!result) {
    throw new Error(
      `${options.label} ${id} finished as ${terminal} without result`,
    );
  }
  if (terminal === "cancelled") {
    throw new Error(`${options.label} ${id} cancelled`);
  }
  if (terminal === "failed" && !options.acceptFailed) {
    throw new Error(`${options.label} ${id} finished as ${terminal}`);
  }
  return result;
}
