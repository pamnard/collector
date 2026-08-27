import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { ItemFile } from "@collector/shared";
import {
  coverNeedsResolve,
  itemCoverStamp,
  orderedIds,
} from "../../lib/dashboard-commit";
import {
  runCoverPathFlight,
  type CoverFlightSlot,
} from "../../lib/dashboard-cover-flight";
import {
  bumpCoverRefreshGeneration,
  isCoverRefreshGenerationCurrent,
  notePendingCoverRefresh,
  takePendingCoverRefreshesForItems,
} from "../../lib/dashboard-cover-refresh";
import { resolveDashboardCoverPathsProgressive } from "../../lib/preload-dashboard-covers";
import { reportServiceError } from "../../services/runtime-error";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfEndPhase,
} from "../../lib/dashboard-perf";
import type {
  DashboardListState,
  StartCoverPathFlight,
} from "./dashboard-list-state-types";
import { commitDashboardCoverMaps } from "./commit-dashboard-cover-maps";

export type UseDashboardCoverFlightOptions = {
  showSkeleton: boolean;
  list: DashboardListState;
  startCoverPathFlightRef: MutableRefObject<StartCoverPathFlight>;
};

export type UseDashboardCoverFlightResult = {
  startCoverPathFlight: StartCoverPathFlight;
  refreshCoverForItem: (itemId: string) => void;
  abortCoverFlight: () => void;
};

export function useDashboardCoverFlight(
  options: UseDashboardCoverFlightOptions,
): UseDashboardCoverFlightResult {
  const { showSkeleton, list, startCoverPathFlightRef } = options;
  const {
    committedItems,
    committedThumbnailPaths,
    committedThumbnailStamps,
    committedThumbnailSizes,
    requestVersionRef,
    queryKeyRef,
    itemIdsRef,
    itemsByIdRef,
    bodyStampsRef,
    streamEndOffsetRef,
    totalCountRef,
    committedItemsRef,
    committedThumbnailPathsRef,
    committedThumbnailStampsRef,
    committedThumbnailSizesRef,
    setCommittedThumbnailPaths,
    setCommittedThumbnailStamps,
    setCommittedThumbnailSizes,
  } = list;

  const coverFlightRef = useRef<CoverFlightSlot>(null);
  const coverRefreshGenerationRef = useRef(new Map<string, number>());
  const pendingCoverRefreshRef = useRef(new Set<string>());
  const refreshCoverForItemRef = useRef<(itemId: string) => void>(() => {});

  const abortCoverFlight = useCallback(() => {
    coverFlightRef.current?.batcher.cancel();
    coverFlightRef.current?.controller.abort();
    coverFlightRef.current = null;
  }, []);

  const refreshCoverForItem = useCallback(
    (itemId: string) => {
      const item = itemsByIdRef.current.get(itemId);
      if (!item) {
        notePendingCoverRefresh(pendingCoverRefreshRef.current, itemId);
        return;
      }
      const generation = bumpCoverRefreshGeneration(
        coverRefreshGenerationRef.current,
        itemId,
      );
      const requestVersion = requestVersionRef.current;
      const cacheKeyForFlight = queryKeyRef.current;
      void resolveDashboardCoverPathsProgressive([item], {
        onResolved: (id, path, size) => {
          if (id !== itemId) {
            return;
          }
          if (requestVersionRef.current !== requestVersion) {
            return;
          }
          if (
            !isCoverRefreshGenerationCurrent(
              coverRefreshGenerationRef.current,
              itemId,
              generation,
            )
          ) {
            return;
          }
          const stamp = itemCoverStamp(item);
          const nextPaths = new Map(committedThumbnailPathsRef.current);
          const nextStamps = new Map(committedThumbnailStampsRef.current);
          const nextSizes = new Map(committedThumbnailSizesRef.current);
          nextPaths.set(itemId, path);
          nextStamps.set(itemId, stamp);
          nextSizes.set(itemId, size);
          commitDashboardCoverMaps({
            flightKey: cacheKeyForFlight,
            flightVersion: requestVersion,
            queryKeyRef,
            requestVersionRef,
            itemIds: itemIdsRef.current,
            itemsById: itemsByIdRef.current,
            bodyStamps: bodyStampsRef.current,
            streamEndOffset: streamEndOffsetRef.current,
            totalCount: totalCountRef.current,
            thumbnailPaths: nextPaths,
            thumbnailStamps: nextStamps,
            thumbnailSizes: nextSizes,
            setCommittedThumbnailPaths,
            setCommittedThumbnailStamps,
            setCommittedThumbnailSizes,
            committedThumbnailPathsRef,
            committedThumbnailStampsRef,
            committedThumbnailSizesRef,
          });
        },
      });
    },
    [
      bodyStampsRef,
      committedThumbnailPathsRef,
      committedThumbnailSizesRef,
      committedThumbnailStampsRef,
      itemIdsRef,
      itemsByIdRef,
      queryKeyRef,
      requestVersionRef,
      setCommittedThumbnailPaths,
      setCommittedThumbnailSizes,
      setCommittedThumbnailStamps,
      streamEndOffsetRef,
      totalCountRef,
    ],
  );

  refreshCoverForItemRef.current = refreshCoverForItem;

  const flushPendingCoverRefreshes = useCallback(
    (orderedItems: ItemFile[]) => {
      const ready = takePendingCoverRefreshesForItems(
        pendingCoverRefreshRef.current,
        orderedItems.map((item) => item.id),
      );
      for (const id of ready) {
        refreshCoverForItemRef.current(id);
      }
    },
    [],
  );

  const startCoverPathFlight = useCallback<StartCoverPathFlight>(
    (
      requestVersion: number,
      orderedItems: ItemFile[],
      flightOptions?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
    ): Promise<void> => {
      flushPendingCoverRefreshes(orderedItems);
      const blockOnCovers = flightOptions?.blockOnCovers ?? false;
      const deferUiCommit = flightOptions?.deferUiCommit ?? false;
      const cacheKeyForFlight = queryKeyRef.current;
      const ids = itemIdsRef.current;
      const byId = itemsByIdRef.current;
      const end = streamEndOffsetRef.current;
      const nextTotal = totalCountRef.current;

      const perfRunId = dashboardPerfActiveRunId();
      dashboardPerfBeginPhase(perfRunId, "coverFlight");
      const coverFlight = runCoverPathFlight({
        requestVersion,
        getRequestVersion: () => requestVersionRef.current,
        orderedItems,
        // Flight window ids — not committedItemsRef (may be empty while paint is held).
        getOrderedIds: () => orderedIds(orderedItems),
        getPaths: () => committedThumbnailPathsRef.current,
        getStamps: () => committedThumbnailStampsRef.current,
        getSizes: () => committedThumbnailSizesRef.current,
        commit: (mergedPaths, mergedStamps, mergedSizes) => {
          committedThumbnailPathsRef.current = mergedPaths;
          committedThumbnailStampsRef.current = mergedStamps;
          committedThumbnailSizesRef.current = mergedSizes;
          if (deferUiCommit) {
            return;
          }
          commitDashboardCoverMaps({
            flightKey: cacheKeyForFlight,
            flightVersion: requestVersion,
            queryKeyRef,
            requestVersionRef,
            itemIds: ids,
            itemsById: byId,
            bodyStamps: bodyStampsRef.current,
            streamEndOffset: end,
            totalCount: nextTotal,
            thumbnailPaths: mergedPaths,
            thumbnailStamps: mergedStamps,
            thumbnailSizes: mergedSizes,
            setCommittedThumbnailPaths,
            setCommittedThumbnailStamps,
            setCommittedThumbnailSizes,
            committedThumbnailPathsRef,
            committedThumbnailStampsRef,
            committedThumbnailSizesRef,
          });
        },
        getFlight: () => coverFlightRef.current,
        setFlight: (next) => {
          coverFlightRef.current = next;
        },
        resolveProgressive: resolveDashboardCoverPathsProgressive,
        // One commit at flight end — no rAF drip of cover chrome (#855).
        scheduleFlush: blockOnCovers ? () => () => {} : undefined,
      });
      const endCoverPerf = () => {
        dashboardPerfEndPhase(perfRunId, "coverFlight");
      };
      if (blockOnCovers) {
        return coverFlight.finally(endCoverPerf);
      }
      void coverFlight
        .catch((err: unknown) => {
          reportServiceError("dashboard cover paths", err);
        })
        .finally(endCoverPerf);
      return Promise.resolve();
    },
    [
      bodyStampsRef,
      committedItemsRef,
      committedThumbnailPathsRef,
      committedThumbnailSizesRef,
      committedThumbnailStampsRef,
      flushPendingCoverRefreshes,
      itemIdsRef,
      itemsByIdRef,
      queryKeyRef,
      requestVersionRef,
      setCommittedThumbnailPaths,
      setCommittedThumbnailSizes,
      setCommittedThumbnailStamps,
      streamEndOffsetRef,
      totalCountRef,
    ],
  );

  startCoverPathFlightRef.current = startCoverPathFlight;

  // Cover-map holes after abort/prune: restart when nothing in-flight for this version.
  useEffect(() => {
    if (showSkeleton) {
      return;
    }
    flushPendingCoverRefreshes(committedItems);
    const requestVersion = requestVersionRef.current;
    const ordered = committedItems;
    const needsResolve = ordered.some((item) =>
      coverNeedsResolve(
        item,
        committedThumbnailPaths,
        committedThumbnailStamps,
        committedThumbnailSizes,
      ),
    );
    if (!needsResolve) {
      return;
    }
    const flight = coverFlightRef.current;
    if (flight && flight.version === requestVersion) {
      return;
    }
    void startCoverPathFlight(requestVersion, ordered);
  }, [
    committedItems,
    committedThumbnailPaths,
    committedThumbnailStamps,
    committedThumbnailSizes,
    flushPendingCoverRefreshes,
    requestVersionRef,
    showSkeleton,
    startCoverPathFlight,
  ]);

  return {
    startCoverPathFlight,
    refreshCoverForItem,
    abortCoverFlight,
  };
}
