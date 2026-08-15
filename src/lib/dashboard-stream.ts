/**
 * Dashboard stream / hydrate merge (#668).
 * Imperative apply of index pages and load-more windows; React state stays in the hook.
 */

import type { DashboardIndexPage } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  zipIdStamps,
} from "./dashboard-commit.ts";
import {
  collectHydratedItems,
  isDashboardPrefetchWindowReady,
  mergeStreamedItemsById,
  shouldApplyDashboardStreamBatch,
} from "./dashboard-display.ts";
import {
  nextStreamWindow,
  planApplyOffsetZeroPage,
  planLoadMore,
} from "./dashboard-query-window.ts";

export type StreamDashboardSliceOptions = {
  ids: string[];
  offset: number;
  limit: number;
  requestVersion: number;
  getRequestVersion: () => number;
  abortCurrentStream: () => void;
  beginStream: () => AbortController;
  hydrate: (
    slice: string[],
    signal: AbortSignal,
  ) => AsyncIterable<ItemFile>;
  mergeItems: (pending: Map<string, ItemFile>) => void;
};

export async function streamDashboardSlice(
  options: StreamDashboardSliceOptions,
): Promise<void> {
  // Stale callers (Strict Mode / superseded query) must not abort the
  // in-flight stream owned by a newer requestVersion.
  if (options.requestVersion !== options.getRequestVersion()) {
    return;
  }
  if (
    !options.ids.length ||
    options.offset >= options.ids.length ||
    options.limit <= 0
  ) {
    return;
  }

  options.abortCurrentStream();
  const controller = options.beginStream();

  const pending = new Map<string, ItemFile>();
  const slice = options.ids.slice(
    options.offset,
    options.offset + options.limit,
  );
  await collectHydratedItems(
    options.hydrate(slice, controller.signal),
    (item) => {
      if (options.getRequestVersion() !== options.requestVersion) {
        return;
      }
      pending.set(item.id, item);
    },
  );

  if (
    !shouldApplyDashboardStreamBatch(
      options.getRequestVersion(),
      options.requestVersion,
      pending.size,
    )
  ) {
    return;
  }

  options.mergeItems(pending);
}

export type ApplyDashboardIndexPageHost = {
  prefetchSize: number;
  getRequestVersion: () => number;
  getPreviousIds: () => string[];
  getPreviousStreamEnd: () => number;
  itemsByIdHas: (id: string) => boolean;
  cachedStampFor: (id: string) => string | undefined;
  getItemIds: () => string[];
  getItemsById: () => Map<string, ItemFile>;
  getStreamEnd: () => number;
  setTotalCount: (total: number) => void;
  setLoadedItemIds: (ids: string[]) => void;
  setBodyStamps: (stamps: Map<string, string>) => void;
  setStreamWindowEnd: (end: number) => void;
  clearCommittedEmpty: () => void;
  replaceWorkingBodiesKeeping: (idsToKeep: string[]) => void;
  intersectCommittedWithPage: (pageItemIds: string[]) => void;
  streamSlice: (
    ids: string[],
    offset: number,
    limit: number,
    requestVersion: number,
  ) => Promise<void>;
};

export async function applyDashboardIndexPage(
  page: DashboardIndexPage,
  requestVersion: number,
  host: ApplyDashboardIndexPageHost,
): Promise<void> {
  host.setTotalCount(page.totalCount);

  if (page.offset !== 0) {
    return;
  }

  const plan = planApplyOffsetZeroPage({
    pageItemIds: page.itemIds,
    pageStamps: page.stamps,
    previousIds: host.getPreviousIds(),
    previousStreamEnd: host.getPreviousStreamEnd(),
    prefetchSize: host.prefetchSize,
    itemsByIdHas: host.itemsByIdHas,
    cachedStampFor: host.cachedStampFor,
  });

  if (plan.kind === "empty") {
    host.setLoadedItemIds([]);
    host.setBodyStamps(new Map());
    host.setStreamWindowEnd(0);
    host.clearCommittedEmpty();
    return;
  }

  const pageStampMap = zipIdStamps(page.itemIds, page.stamps);

  const streamWindow = async () => {
    await host.streamSlice(
      page.itemIds,
      0,
      plan.preservedEnd,
      requestVersion,
    );
    if (
      !isDashboardPrefetchWindowReady(
        host.getItemIds(),
        host.getItemsById(),
        host.getStreamEnd(),
      )
    ) {
      // First stream often races with effect abort on query switch — retry once.
      await host.streamSlice(
        page.itemIds,
        0,
        plan.preservedEnd,
        requestVersion,
      );
    }
    if (host.getRequestVersion() === requestVersion) {
      host.setBodyStamps(pageStampMap);
    }
  };

  if (plan.kind === "ids-changed") {
    host.setLoadedItemIds(page.itemIds);
    host.replaceWorkingBodiesKeeping(plan.idsToKeepBodies);
    host.setStreamWindowEnd(plan.preservedEnd);
    host.intersectCommittedWithPage(page.itemIds);
    await streamWindow();
    return;
  }

  host.setStreamWindowEnd(plan.preservedEnd);
  if (plan.needsStream) {
    await streamWindow();
  } else {
    host.setBodyStamps(pageStampMap);
  }
}

export type RunDashboardLoadMoreOptions = {
  isLoading: boolean;
  isLoadingMore: boolean;
  streamEndOffset: number;
  loadedCount: number;
  totalCount: number;
  prefetchSize: number;
  getRequestVersion: () => number;
  getItemIds: () => string[];
  setIsLoadingMore: (value: boolean) => void;
  setStreamWindowEnd: (end: number) => void;
  setLoadedItemIds: (ids: string[]) => void;
  setTotalCount: (total: number) => void;
  setError: (message: string | null) => void;
  streamSlice: (
    ids: string[],
    offset: number,
    limit: number,
    requestVersion: number,
  ) => Promise<void>;
  fetchMoreIds: (loadedCount: number) => Promise<{
    itemIds: string[];
    totalCount: number;
  }>;
  reportError: (label: string, err: unknown) => void;
  /** Current stream end for nextStreamWindow (may differ from plan input). */
  getStreamEnd?: () => number;
};

export async function runDashboardLoadMore(
  options: RunDashboardLoadMoreOptions,
): Promise<void> {
  const plan = planLoadMore({
    isLoading: options.isLoading,
    isLoadingMore: options.isLoadingMore,
    streamEndOffset: options.streamEndOffset,
    loadedCount: options.loadedCount,
    totalCount: options.totalCount,
    prefetchSize: options.prefetchSize,
  });
  if (plan.kind === "noop") {
    return;
  }

  const requestVersion = options.getRequestVersion();
  const loadedCount = options.loadedCount;
  options.setIsLoadingMore(true);

  const streamNextWindow = (ids: string[]) => {
    const streamEnd =
      options.getStreamEnd?.() ?? options.streamEndOffset;
    const { offset, limit, nextEnd } = nextStreamWindow(
      streamEnd,
      ids.length,
      options.prefetchSize,
    );
    options.setStreamWindowEnd(nextEnd);

    void options
      .streamSlice(ids, offset, limit, requestVersion)
      .catch((err: unknown) => {
        if (options.getRequestVersion() !== requestVersion) {
          return;
        }
        options.reportError("dashboard load more", err);
        options.setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (options.getRequestVersion() === requestVersion) {
          options.setIsLoadingMore(false);
        }
      });
  };

  if (plan.kind === "fetch-ids-then-stream") {
    try {
      const page = await options.fetchMoreIds(loadedCount);
      if (options.getRequestVersion() !== requestVersion) {
        return;
      }
      options.setTotalCount(page.totalCount);
      const mergedIds = [...options.getItemIds(), ...page.itemIds];
      options.setLoadedItemIds(mergedIds);
      streamNextWindow(mergedIds);
    } catch (err: unknown) {
      if (options.getRequestVersion() !== requestVersion) {
        return;
      }
      options.reportError("dashboard load more ids", err);
      options.setError(err instanceof Error ? err.message : String(err));
      options.setIsLoadingMore(false);
    }
    return;
  }

  streamNextWindow(options.getItemIds());
}

/** Merge streamed bodies into a Map (pure helper for hook setState). */
export function mergePendingIntoItemsById(
  current: Map<string, ItemFile>,
  pending: Map<string, ItemFile>,
): Map<string, ItemFile> {
  return mergeStreamedItemsById(current, pending);
}
