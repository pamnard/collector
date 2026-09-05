/**
 * Job permanent-failure fan-out.
 * Runner notifies once when a job reaches terminal `failed`; host broadcasts to UI.
 * Enqueue failures use the same channel (#639 cutover).
 */

import type { JobPermanentFailure, Subscription } from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import type { JobQueue } from "./jobs/job-queue.js";

export type { JobPermanentFailure };

export interface JobPermanentFailureStore {
  subscribe(
    onUpdate: (payload: JobPermanentFailure) => void,
  ): Subscription;
  notify(payload: JobPermanentFailure): void;
}

export function createJobPermanentFailureStore(): JobPermanentFailureStore {
  const listeners = new Set<(payload: JobPermanentFailure) => void>();

  return {
    subscribe(onUpdate) {
      listeners.add(onUpdate);
      return subscriptionFromTeardown(() => {
        listeners.delete(onUpdate);
      });
    },
    notify(payload: JobPermanentFailure) {
      for (const listener of listeners) {
        listener(payload);
      }
    },
  };
}

export function notifyJobPermanentFailure(
  store: JobPermanentFailureStore,
  info: JobPermanentFailure,
  logKind: "permanent failure" | "enqueue failure" = "permanent failure",
): void {
  console.error(`[jobs] ${logKind}`, {
    jobId: info.id,
    type: info.type,
    summary: info.summary,
    detail: info.detail,
    attempts: info.attempts,
  });
  store.notify(info);
}

/**
 * Surface a failed enqueue on the same AlertStack path as terminal job failures.
 * Uses a synthetic id — no row was inserted into the jobs store.
 */
export function reportEnqueueFailure(
  store: JobPermanentFailureStore,
  type: string,
  error: unknown,
  createId: () => string = () => crypto.randomUUID(),
): void {
  const message = error instanceof Error ? error.message : String(error);
  notifyJobPermanentFailure(
    store,
    {
      id: `enqueue-failed:${type}:${createId()}`,
      type,
      summary: "Не удалось поставить задачу в очередь",
      detail: `${type}: ${message}`,
      attempts: 0,
    },
    "enqueue failure",
  );
}

export async function enqueueJobWithFailureReporting(
  deps: {
    requireJobs: () => JobQueue;
    jobPermanentFailure: JobPermanentFailureStore;
  },
  type: string,
  enqueue: (queue: JobQueue) => Promise<unknown>,
): Promise<void> {
  try {
    await enqueue(deps.requireJobs());
  } catch (error) {
    reportEnqueueFailure(deps.jobPermanentFailure, type, error);
  }
}
