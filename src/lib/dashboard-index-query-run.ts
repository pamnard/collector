/**
 * Dashboard index query window orchestration (#929).
 * Pure of React: hook bumps requestVersion, wires abort, supplies sinks.
 */

import type {
  DashboardIndexPage,
  DashboardItemSort,
  IndexQueryResult,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { NavFilter } from "../types/ui.ts";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import {
  mapIndexQueryResult,
} from "./dashboard-display.ts";
import { stateFromDashboardCacheEntry } from "./dashboard-query-load.ts";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfEndPhase,
} from "./dashboard-perf.ts";

export type DashboardIndexPageApply = (
  page: DashboardIndexPage,
  requestVersion: number,
) => Promise<void>;

export type DashboardCommitWorking = (
  requestVersion: number,
  options: { blockOnCovers: boolean },
) => Promise<void>;

export type PrepareDashboardIndexQueryWindowSinks = {
  setError: (message: string | null) => void;
  setLoadedItemIds: (ids: string[]) => void;
  setItemsById: (items: Map<string, ItemFile>) => void;
  setTotalCount: (total: number) => void;
  setStreamWindowEnd: (end: number) => void;
  setIsLoading: (loading: boolean) => void;
  /** Sync refs that mirror working maps. */
  syncWorkingRefs: (working: {
    itemsById: Map<string, ItemFile>;
    bodyStamps: Map<string, string>;
    totalCount: number;
  }) => void;
  clearWorkingBodies: () => void;
  getCommittedCount: () => number;
  abortStream: () => void;
  abortCoverFlight: () => void;
};

export type PrepareDashboardIndexQueryWindowInput = {
  queryKey: string;
  getCached: (key: string) => DashboardQueryCacheEntry | null | undefined;
  sinks: PrepareDashboardIndexQueryWindowSinks;
};

export type PrepareDashboardIndexQueryWindowResult = {
  hadCacheHit: boolean;
};

/** Sync prep before async index fetch: apply cache or clear cold-miss bodies. */
export function prepareDashboardIndexQueryWindow(
  input: PrepareDashboardIndexQueryWindowInput,
): PrepareDashboardIndexQueryWindowResult {
  const { sinks } = input;
  const cached = input.getCached(input.queryKey);
  sinks.setError(null);

  if (cached) {
    const working = stateFromDashboardCacheEntry(cached);
    sinks.setLoadedItemIds(working.itemIds);
    sinks.syncWorkingRefs({
      itemsById: working.itemsById,
      bodyStamps: working.bodyStamps,
      totalCount: working.totalCount,
    });
    sinks.setItemsById(working.itemsById);
    sinks.setTotalCount(working.totalCount);
    sinks.setStreamWindowEnd(working.streamEndOffset);
    sinks.setIsLoading(false);
    sinks.abortStream();
    sinks.abortCoverFlight();
    return { hadCacheHit: true };
  }

  // Cache miss after invalidate: drop bodies so ids-same re-hydrates.
  sinks.clearWorkingBodies();
  sinks.setItemsById(new Map());
  if (sinks.getCommittedCount() === 0) {
    sinks.setIsLoading(true);
    sinks.setLoadedItemIds([]);
    sinks.syncWorkingRefs({
      itemsById: new Map(),
      bodyStamps: new Map(),
      totalCount: 0,
    });
    sinks.setTotalCount(0);
    sinks.setStreamWindowEnd(0);
  }
  sinks.abortStream();
  sinks.abortCoverFlight();
  return { hadCacheHit: false };
}

export type RunDashboardIndexQueryWindowInput = {
  requestVersion: number;
  signal: AbortSignal;
  filter: NavFilter;
  searchQuery: string;
  sort: DashboardItemSort;
  prefetchSize: number;
  getRequestVersion: () => number;
  queryIndex: (
    filter: NavFilter,
    search: string,
    range: { offset: number; limit: number },
    sort: DashboardItemSort,
  ) => Promise<IndexQueryResult>;
  applyIndexPage: DashboardIndexPageApply;
  commitWorkingToDisplay: DashboardCommitWorking;
  setError: (message: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setQueryBusy: (busy: boolean) => void;
  reportError: (label: string, err: unknown) => void;
};

/**
 * Fetch first index page, apply, then block-on-covers commit for offset 0.
 * Respects abort signal + requestVersion races.
 */
export async function runDashboardIndexQueryWindow(
  input: RunDashboardIndexQueryWindowInput,
): Promise<void> {
  const {
    requestVersion,
    signal,
    filter,
    searchQuery,
    sort,
    prefetchSize,
    getRequestVersion,
    queryIndex,
    applyIndexPage,
    commitWorkingToDisplay,
    setError,
    setIsLoading,
    setQueryBusy,
    reportError,
  } = input;

  const tryCommitAfterIndexPage = async () => {
    if (getRequestVersion() !== requestVersion) {
      return;
    }
    try {
      // Cold first window: await covers, then one list+maps paint (#855).
      await commitWorkingToDisplay(requestVersion, { blockOnCovers: true });
    } catch (err: unknown) {
      if (getRequestVersion() !== requestVersion) {
        return;
      }
      reportError("dashboard cover paths", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (getRequestVersion() === requestVersion) {
        const perfRunId = dashboardPerfActiveRunId();
        dashboardPerfBeginPhase(perfRunId, "loadingOff");
        setIsLoading(false);
        dashboardPerfEndPhase(perfRunId, "loadingOff");
        setQueryBusy(false);
      }
    }
  };

  try {
    if (signal.aborted) {
      return;
    }
    const perfRunId = dashboardPerfActiveRunId();
    dashboardPerfBeginPhase(perfRunId, "queryIndex");
    const result = await queryIndex(
      filter,
      searchQuery,
      { offset: 0, limit: prefetchSize },
      sort,
    );
    dashboardPerfEndPhase(perfRunId, "queryIndex");
    if (signal.aborted || getRequestVersion() !== requestVersion) {
      return;
    }
    const page = mapIndexQueryResult(result);
    dashboardPerfBeginPhase(perfRunId, "applyIndexPage");
    await applyIndexPage(page, requestVersion);
    dashboardPerfEndPhase(perfRunId, "applyIndexPage");
    if (getRequestVersion() !== requestVersion) {
      return;
    }
    if (page.offset === 0) {
      await tryCommitAfterIndexPage();
    }
  } catch (err: unknown) {
    if (signal.aborted || getRequestVersion() !== requestVersion) {
      return;
    }
    reportError("dashboard index page", err);
    setError(err instanceof Error ? err.message : String(err));
    setIsLoading(false);
    setQueryBusy(false);
  }
}

export type RunDashboardSyncRepublishInput = {
  requestVersion: number;
  getRequestVersion: () => number;
  getItemIdsLength: () => number;
  prefetchSize: number;
  getFilter: () => NavFilter;
  getSearchQuery: () => string;
  getSort: () => DashboardItemSort;
  queryIndex: (
    filter: NavFilter,
    search: string,
    range: { offset: number; limit: number },
    sort: DashboardItemSort,
  ) => Promise<IndexQueryResult>;
  applyIndexPage: DashboardIndexPageApply;
  commitWorkingToDisplay: DashboardCommitWorking;
  reportError: (label: string, err: unknown) => void;
};

/** Throttled IndexPort republish body (non-blocking covers). */
export async function runDashboardSyncRepublish(
  input: RunDashboardSyncRepublishInput,
): Promise<void> {
  const {
    requestVersion,
    getRequestVersion,
    getItemIdsLength,
    prefetchSize,
    getFilter,
    getSearchQuery,
    getSort,
    queryIndex,
    applyIndexPage,
    commitWorkingToDisplay,
    reportError,
  } = input;

  try {
    const limit = Math.max(getItemIdsLength(), prefetchSize);
    const result = await queryIndex(
      getFilter(),
      getSearchQuery(),
      { offset: 0, limit },
      getSort(),
    );
    if (getRequestVersion() !== requestVersion) {
      return;
    }
    await applyIndexPage(mapIndexQueryResult(result), requestVersion);
    if (getRequestVersion() !== requestVersion) {
      return;
    }
    await commitWorkingToDisplay(requestVersion, {
      blockOnCovers: false,
    });
  } catch (err: unknown) {
    if (getRequestVersion() !== requestVersion) {
      return;
    }
    reportError("dashboard sync republish", err);
  }
}

/** Cleanup when the index-query effect tears down for this requestVersion. */
export function cleanupDashboardIndexQueryWindow(options: {
  requestVersion: number;
  getRequestVersion: () => number;
  abortController: AbortController;
  abortStream: () => void;
  abortCoverFlight: () => void;
  setQueryBusy: (busy: boolean) => void;
}): void {
  options.abortController.abort();
  options.abortStream();
  options.abortCoverFlight();
  if (options.getRequestVersion() === options.requestVersion) {
    options.setQueryBusy(false);
  }
}
