import type { ItemFile } from "@collector/shared";
import type { ItemThumbnailPixelSize } from "@collector/api";
import type { MutableRefObject } from "react";
import { buildDashboardQueryCacheEntry } from "../../lib/dashboard-query-load";
import {
  applyDashboardQueryCacheCoverFlightPatch,
  setDashboardQueryCache,
} from "../../services/dashboard-query-cache";
import type { DashboardListState } from "./dashboard-list-state-types";

/** Apply cover-flight maps to query cache + committed React state (skip if stale). */
export function commitDashboardCoverMaps(options: {
  flightKey: string;
  flightVersion: number;
  queryKeyRef: MutableRefObject<string>;
  requestVersionRef: MutableRefObject<number>;
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  bodyStamps: Map<string, string>;
  streamEndOffset: number;
  totalCount: number;
  thumbnailPaths: Map<string, string | null>;
  thumbnailStamps: Map<string, string>;
  thumbnailSizes: Map<string, ItemThumbnailPixelSize | null>;
  setCommittedThumbnailPaths: DashboardListState["setCommittedThumbnailPaths"];
  setCommittedThumbnailStamps: DashboardListState["setCommittedThumbnailStamps"];
  setCommittedThumbnailSizes: DashboardListState["setCommittedThumbnailSizes"];
  committedThumbnailPathsRef: DashboardListState["committedThumbnailPathsRef"];
  committedThumbnailStampsRef: DashboardListState["committedThumbnailStampsRef"];
  committedThumbnailSizesRef: DashboardListState["committedThumbnailSizesRef"];
}): boolean {
  const result = applyDashboardQueryCacheCoverFlightPatch({
    flightKey: options.flightKey,
    flightVersion: options.flightVersion,
    getLiveKey: () => options.queryKeyRef.current,
    getLiveVersion: () => options.requestVersionRef.current,
    thumbnailPaths: options.thumbnailPaths,
    thumbnailStamps: options.thumbnailStamps,
    thumbnailSizes: options.thumbnailSizes,
    rewriteFull: () => {
      setDashboardQueryCache(
        options.flightKey,
        buildDashboardQueryCacheEntry({
          itemIds: options.itemIds,
          itemsById: options.itemsById,
          bodyStamps: options.bodyStamps,
          streamEndOffset: options.streamEndOffset,
          totalCount: options.totalCount,
          thumbnailPaths: options.thumbnailPaths,
          thumbnailStamps: options.thumbnailStamps,
          thumbnailSizes: options.thumbnailSizes,
        }),
      );
    },
  });
  if (result === "skipped") {
    return false;
  }
  options.setCommittedThumbnailPaths(options.thumbnailPaths);
  options.setCommittedThumbnailStamps(options.thumbnailStamps);
  options.setCommittedThumbnailSizes(options.thumbnailSizes);
  options.committedThumbnailPathsRef.current = options.thumbnailPaths;
  options.committedThumbnailStampsRef.current = options.thumbnailStamps;
  options.committedThumbnailSizesRef.current = options.thumbnailSizes;
  return true;
}
