/**
 * Dashboard query-key warm/cold switch (#929).
 * Pure of React: hook supplies cache/session peek + list sinks.
 */

import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import { readInitialDashboardCacheEntry } from "./dashboard-query-load.ts";

export type ApplyDashboardQueryKeyChangeSinks = {
  abortCoverFlight: () => void;
  setError: (message: string | null) => void;
  applyCacheEntryToState: (entry: DashboardQueryCacheEntry) => void;
  setIsLoading: (loading: boolean) => void;
  clearWorkingWindow: () => void;
  clearCommittedPaint: () => void;
};

export type ApplyDashboardQueryKeyChangeInput<TSnapshot> = {
  prevQueryKey: string;
  nextQueryKey: string;
  prevCommittedCount: number;
  vaultId: string | null;
  getCached: (key: string) => DashboardQueryCacheEntry | null | undefined;
  setCached: (key: string, entry: DashboardQueryCacheEntry) => void;
  peekWarmSnapshot: () => TSnapshot | null | undefined;
  snapshotToEntry: (snap: TSnapshot) => DashboardQueryCacheEntry;
  sinks: ApplyDashboardQueryKeyChangeSinks;
};

export type ApplyDashboardQueryKeyChangeResult =
  | { kind: "unchanged" }
  | { kind: "warm" }
  | { kind: "cold" };

/**
 * On query-key change: abort cover flight, warm from cache/session or cold-clear working.
 * Caller updates `queryKeyRef` when result is not `unchanged`.
 */
export function applyDashboardQueryKeyChange<TSnapshot>(
  input: ApplyDashboardQueryKeyChangeInput<TSnapshot>,
): ApplyDashboardQueryKeyChangeResult {
  if (input.prevQueryKey === input.nextQueryKey) {
    return { kind: "unchanged" };
  }

  const { sinks } = input;
  // Drop the previous folder's cover flight before warm maps land (#913).
  sinks.abortCoverFlight();
  sinks.setError(null);

  const warmed = readInitialDashboardCacheEntry({
    cacheKey: input.nextQueryKey,
    getCached: input.getCached,
    setCached: input.setCached,
    vaultId: input.vaultId,
    peekWarmSnapshot: input.peekWarmSnapshot,
    snapshotToEntry: input.snapshotToEntry,
  });
  if (warmed) {
    sinks.applyCacheEntryToState(warmed);
    sinks.setIsLoading(false);
    return { kind: "warm" };
  }

  // Keep committed paint until the new query commits — clearing here forces
  // grid-skeleton blank flash on every cold folder switch.
  sinks.clearWorkingWindow();
  if (input.prevCommittedCount === 0) {
    sinks.clearCommittedPaint();
  }
  sinks.setIsLoading(true);
  return { kind: "cold" };
}
