/**
 * Derived index catch-up status (#767).
 * Observes `itemDerivedRefresh` job queue depth — not VaultIndexSyncStatus.
 */

import type {
  DerivedCatchUpStatus,
  JobStats,
  Subscription,
} from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";

/** Agreed job type id from #766 — observe only; handler lives in sibling PR. */
export const ITEM_DERIVED_REFRESH_JOB_TYPE = "itemDerivedRefresh";

export type { DerivedCatchUpStatus } from "@collector/api";

const IDLE_STATUS: DerivedCatchUpStatus = {
  vaultId: null,
  status: "idle",
  pending: 0,
  running: 0,
};

export function deriveCatchUpStatusFromJobStats(
  stats: JobStats,
  vaultId: string | null,
): DerivedCatchUpStatus {
  const typeStats = stats.byType[ITEM_DERIVED_REFRESH_JOB_TYPE];
  const pending = typeStats?.pending ?? 0;
  const running = typeStats?.running ?? 0;
  const active = pending + running > 0;
  return {
    vaultId: active ? vaultId : null,
    status: active ? "running" : "idle",
    pending,
    running,
  };
}

export interface DerivedCatchUpStatusStore {
  subscribe(onUpdate: (status: DerivedCatchUpStatus) => void): Subscription;
  get(): DerivedCatchUpStatus;
  set(next: DerivedCatchUpStatus): void;
}

export function createDerivedCatchUpStatusStore(
  initial: DerivedCatchUpStatus = IDLE_STATUS,
): DerivedCatchUpStatusStore {
  let status: DerivedCatchUpStatus = { ...initial };
  const listeners = new Set<(status: DerivedCatchUpStatus) => void>();

  return {
    subscribe(onUpdate) {
      onUpdate(status);
      listeners.add(onUpdate);
      return subscriptionFromTeardown(() => {
        listeners.delete(onUpdate);
      });
    },
    get() {
      return status;
    },
    set(next) {
      const prev = status;
      if (
        prev.vaultId === next.vaultId &&
        prev.status === next.status &&
        prev.pending === next.pending &&
        prev.running === next.running
      ) {
        return;
      }
      status = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}

export function createDerivedCatchUpStatusRefresher(deps: {
  store: DerivedCatchUpStatusStore;
  stats: () => Promise<JobStats>;
  getActiveVaultId: () => string | null;
}): { refresh: () => Promise<void> } {
  return {
    async refresh() {
      const stats = await deps.stats();
      const next = deriveCatchUpStatusFromJobStats(
        stats,
        deps.getActiveVaultId(),
      );
      deps.store.set(next);
    },
  };
}
