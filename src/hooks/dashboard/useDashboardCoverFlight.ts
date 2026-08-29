import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { ItemFile } from "@collector/shared";
import type { CoverController } from "../../lib/cover-controller";
import { reportServiceError } from "../../services/runtime-error";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfEndPhase,
} from "../../lib/dashboard-perf";
import type { StartCoverPathFlight } from "./dashboard-list-state-types";

export type UseDashboardCoverFlightOptions = {
  showSkeleton: boolean;
  committedItems: ItemFile[];
  covers: CoverController;
  startCoverPathFlightRef: MutableRefObject<StartCoverPathFlight>;
};

export type UseDashboardCoverFlightResult = {
  startCoverPathFlight: StartCoverPathFlight;
  refreshCoverForItem: (itemId: string) => void;
  abortCoverFlight: () => void;
  probeStickyNulls: (items: ItemFile[]) => void;
};

export function useDashboardCoverFlight(
  options: UseDashboardCoverFlightOptions,
): UseDashboardCoverFlightResult {
  const { showSkeleton, committedItems, covers, startCoverPathFlightRef } =
    options;
  const committedItemsRef = useRef(committedItems);
  committedItemsRef.current = committedItems;
  const showSkeletonRef = useRef(showSkeleton);
  showSkeletonRef.current = showSkeleton;

  const startCoverPathFlight = useCallback<StartCoverPathFlight>(
    (
      requestVersion: number,
      orderedItems: ItemFile[],
      flightOptions?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
    ): Promise<void> => {
      const blockOnCovers = flightOptions?.blockOnCovers ?? false;
      const perfRunId = dashboardPerfActiveRunId();
      dashboardPerfBeginPhase(perfRunId, "coverFlight");
      const coverFlight = covers.beginFlight(
        requestVersion,
        orderedItems,
        flightOptions,
      );
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
    [covers],
  );

  startCoverPathFlightRef.current = startCoverPathFlight;

  const syncDisplayed = (items: ItemFile[]) => {
    covers.noteDisplayedMaps(items);
    covers.ensureFlightForHoles(items);
  };

  useEffect(() => {
    if (showSkeleton) {
      return;
    }
    syncDisplayed(committedItems);
  }, [committedItems, covers, showSkeleton]);

  useEffect(() => {
    return covers.subscribe(() => {
      if (showSkeletonRef.current) {
        return;
      }
      syncDisplayed(committedItemsRef.current);
    });
  }, [covers]);

  return {
    startCoverPathFlight,
    refreshCoverForItem: covers.refresh,
    abortCoverFlight: covers.abort,
    probeStickyNulls: covers.probeStickyNulls,
  };
}
