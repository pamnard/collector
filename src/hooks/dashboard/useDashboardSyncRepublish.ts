/**
 * IndexPort-driven dashboard sync republish (#929 / #367).
 * Owns throttle publisher + status schedule/flush effects.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import type {
  DashboardItemSort,
  VaultIndexSyncStatus,
} from "@collector/api";
import { createThrottledPublisher } from "../../lib/dashboard-display";
import {
  runDashboardSyncRepublish,
  type DashboardCommitWorking,
  type DashboardIndexPageApply,
} from "../../lib/dashboard-index-query-run";
import type { NavFilter } from "../../types/ui";
import {
  DASHBOARD_PREFETCH_SIZE,
  getCollectorService,
} from "../../services/collector-client";
import { reportServiceError } from "../../services/runtime-error";

/** Matches service `syncRepublishThrottleMs` for IndexPort-driven re-query (#367). */
export const DASHBOARD_SYNC_REPUBLISH_MS = 500;

export type SyncRepublishControls = {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
};

export type UseDashboardSyncRepublishOptions = {
  indexSync: VaultIndexSyncStatus;
  requestVersionRef: MutableRefObject<number>;
  itemIdsRef: MutableRefObject<string[]>;
  filterRef: MutableRefObject<NavFilter>;
  searchQueryRef: MutableRefObject<string>;
  sortRef: MutableRefObject<DashboardItemSort>;
  applyIndexPage: DashboardIndexPageApply;
  commitWorkingToDisplay: DashboardCommitWorking;
};

export type UseDashboardSyncRepublishResult = {
  syncRepublishRef: MutableRefObject<SyncRepublishControls | null>;
};

export function useDashboardSyncRepublish(
  options: UseDashboardSyncRepublishOptions,
): UseDashboardSyncRepublishResult {
  const {
    indexSync,
    requestVersionRef,
    itemIdsRef,
    filterRef,
    searchQueryRef,
    sortRef,
    applyIndexPage,
    commitWorkingToDisplay,
  } = options;

  const prevIndexSyncStatusRef = useRef(indexSync.status);
  const syncRepublishRef = useRef<SyncRepublishControls | null>(null);

  useEffect(() => {
    const publisher = createThrottledPublisher(() => {
      const requestVersion = requestVersionRef.current;
      void runDashboardSyncRepublish({
        requestVersion,
        getRequestVersion: () => requestVersionRef.current,
        getItemIdsLength: () => itemIdsRef.current.length,
        prefetchSize: DASHBOARD_PREFETCH_SIZE,
        getFilter: () => filterRef.current,
        getSearchQuery: () => searchQueryRef.current,
        getSort: () => sortRef.current,
        queryIndex: (filter, search, range, sort) =>
          getCollectorService().items.queryIndex(filter, search, range, sort),
        applyIndexPage,
        commitWorkingToDisplay,
        reportError: reportServiceError,
      });
    }, DASHBOARD_SYNC_REPUBLISH_MS);
    syncRepublishRef.current = publisher;
    return () => {
      publisher.cancel();
      if (syncRepublishRef.current === publisher) {
        syncRepublishRef.current = null;
      }
    };
  }, [
    applyIndexPage,
    commitWorkingToDisplay,
    filterRef,
    itemIdsRef,
    requestVersionRef,
    searchQueryRef,
    sortRef,
  ]);

  useEffect(() => {
    const prev = prevIndexSyncStatusRef.current;
    prevIndexSyncStatusRef.current = indexSync.status;
    const active =
      indexSync.status === "running" || indexSync.status === "rebuilding";
    if (active) {
      syncRepublishRef.current?.schedule();
    }
    if (
      (prev === "running" || prev === "rebuilding") &&
      indexSync.status === "done"
    ) {
      syncRepublishRef.current?.flush();
    }
  }, [
    indexSync.status,
    indexSync.progress?.processed,
    indexSync.progress?.total,
    indexSync.metadataReady,
    indexSync.ftsReady,
  ]);

  return { syncRepublishRef };
}
