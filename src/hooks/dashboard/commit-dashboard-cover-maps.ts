import type { ItemFile } from "@collector/shared";
import type { MutableRefObject } from "react";
import { buildDashboardQueryCacheEntry } from "../../lib/dashboard-query-load";
import {
  coverMapsForPersistence,
  type CoverMaps,
} from "../../lib/cover-maps";
import {
  applyDashboardQueryCacheCoverFlightPatch,
  setDashboardQueryCache,
} from "../../services/dashboard-query-cache";

/** Persist cover maps to the query cache (CoverController SoT owns React). */
export function persistDashboardCoverMapsToCache(options: {
  flightKey: string;
  flightVersion: number;
  queryKeyRef: MutableRefObject<string>;
  requestVersionRef: MutableRefObject<number>;
  itemIds: string[];
  itemsById: Map<string, ItemFile>;
  bodyStamps: Map<string, string>;
  streamEndOffset: number;
  totalCount: number;
  maps: CoverMaps;
}): boolean {
  const persisted = coverMapsForPersistence(options.maps);
  const result = applyDashboardQueryCacheCoverFlightPatch({
    flightKey: options.flightKey,
    flightVersion: options.flightVersion,
    getLiveKey: () => options.queryKeyRef.current,
    getLiveVersion: () => options.requestVersionRef.current,
    covers: persisted,
    rewriteFull: () => {
      setDashboardQueryCache(
        options.flightKey,
        buildDashboardQueryCacheEntry({
          itemIds: options.itemIds,
          itemsById: options.itemsById,
          bodyStamps: options.bodyStamps,
          streamEndOffset: options.streamEndOffset,
          totalCount: options.totalCount,
          covers: persisted,
        }),
      );
    },
  });
  return result !== "skipped";
}
