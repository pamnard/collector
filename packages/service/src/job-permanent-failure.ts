/**
 * Job permanent-failure fan-out.
 * Runner notifies once when a job reaches terminal `failed`; host broadcasts to UI.
 * Enqueue failures use the same channel (#639 cutover).
 */

import type { JobPermanentFailure, Subscription } from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";

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
  const info: JobPermanentFailure = {
    id: `enqueue-failed:${type}:${createId()}`,
    type,
    error: `enqueue failed: ${message}`,
    attempts: 0,
  };
  console.error("[jobs] enqueue failure", {
    jobId: info.id,
    type: info.type,
    error: info.error,
  });
  store.notify(info);
}
