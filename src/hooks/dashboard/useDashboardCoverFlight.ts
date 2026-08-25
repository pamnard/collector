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

  const abortCoverFlight = useCallback(() => {
    coverFlightRef.current?.batcher.cancel();
    coverFlightRef.current?.controller.abort();
    coverFlightRef.current = null;
  }, []);

  const startCoverPathFlight = useCallback<StartCoverPathFlight>(
    (
      requestVersion: number,
      orderedItems: ItemFile[],
      flightOptions?: { blockOnCovers?: boolean },
    ): Promise<void> => {
      const blockOnCovers = flightOptions?.blockOnCovers ?? false;
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
        getOrderedIds: () => orderedIds(committedItemsRef.current),
        getPaths: () => committedThumbnailPathsRef.current,
        getStamps: () => committedThumbnailStampsRef.current,
        getSizes: () => committedThumbnailSizesRef.current,
        commit: (mergedPaths, mergedStamps, mergedSizes) => {
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
    requestVersionRef,
    showSkeleton,
    startCoverPathFlight,
  ]);

  const refreshCoverForItem = useCallback(
    (itemId: string) => {
      const item = itemsByIdRef.current.get(itemId);
      if (!item) {
        return;
      }
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

  return {
    startCoverPathFlight,
    refreshCoverForItem,
    abortCoverFlight,
  };
}
