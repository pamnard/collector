/**
 * Job permanent-failure fan-out.
 * Runner notifies once when a job reaches terminal `failed`; host broadcasts to UI.
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
