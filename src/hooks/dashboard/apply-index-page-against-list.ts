import type { ItemFile } from "@collector/shared";
import { flushSync } from "react-dom";
import { intersectCommittedWithPageIdsHoldPaint } from "../../lib/dashboard-commit";
import { emptyCoverMaps } from "../../lib/cover-maps";
import { revealHeldListPaint } from "../../lib/dashboard-cold-reveal";
import { applyDashboardIndexPage } from "../../lib/dashboard-stream";
import { DASHBOARD_PREFETCH_SIZE } from "../../services/collector-client";
import {
  dashboardPerfActiveRunId,
  dashboardPerfNoteIntersect,
} from "../../lib/dashboard-perf";
import type { DashboardListState } from "./dashboard-list-state-types";

type StreamSlice = (
  ids: string[],
  offset: number,
  limit: number,
  requestVersion: number,
) => Promise<void>;

/** Wire `applyDashboardIndexPage` to list-state refs/setters. */
export async function applyIndexPageAgainstListState(
  list: Pick<
    DashboardListState,
    | "requestVersionRef"
    | "itemIdsRef"
    | "streamEndOffsetRef"
    | "itemsByIdRef"
    | "bodyStampsRef"
    | "totalCountRef"
    | "setTotalCount"
    | "setLoadedItemIds"
    | "setStreamWindowEnd"
    | "applyListSnapshot"
    | "setItemsById"
    | "committedItemsRef"
    | "covers"
  >,
  page: {
    itemIds: string[];
    stamps: string[];
    totalCount: number;
    offset: number;
  },
  requestVersion: number,
  streamSlice: StreamSlice,
): Promise<void> {
  await applyDashboardIndexPage(page, requestVersion, {
    prefetchSize: DASHBOARD_PREFETCH_SIZE,
    getRequestVersion: () => list.requestVersionRef.current,
    getPreviousIds: () => list.itemIdsRef.current,
    getPreviousStreamEnd: () => list.streamEndOffsetRef.current,
    itemsByIdHas: (id) => list.itemsByIdRef.current.has(id),
    cachedStampFor: (id) => list.bodyStampsRef.current.get(id),
    getItemIds: () => list.itemIdsRef.current,
    getItemsById: () => list.itemsByIdRef.current,
    getStreamEnd: () => list.streamEndOffsetRef.current,
    setTotalCount: (total) => {
      list.totalCountRef.current = total;
      list.setTotalCount(total);
    },
    setLoadedItemIds: list.setLoadedItemIds,
    setBodyStamps: (stamps) => {
      list.bodyStampsRef.current = stamps;
    },
    setStreamWindowEnd: list.setStreamWindowEnd,
    clearCommittedEmpty: () => {
      list.applyListSnapshot({
        itemIds: list.itemIdsRef.current,
        itemsById: list.itemsByIdRef.current,
        bodyStamps: list.bodyStampsRef.current,
        streamEndOffset: list.streamEndOffsetRef.current,
        totalCount: list.totalCountRef.current,
        committedItems: [],
        committedTotalCount: 0,
        covers: emptyCoverMaps(),
      });
    },
    replaceWorkingBodiesKeeping: (idsToKeep) => {
      const kept = new Map<string, ItemFile>();
      for (const id of idsToKeep) {
        const existing = list.itemsByIdRef.current.get(id);
        if (existing) {
          kept.set(id, existing);
        }
      }
      list.itemsByIdRef.current = kept;
      list.setItemsById(kept);
    },
    intersectCommittedWithPage: (pageItemIds) => {
      const prevCommittedLen = list.committedItemsRef.current.length;
      const nextCommitted = intersectCommittedWithPageIdsHoldPaint(
        list.committedItemsRef.current,
        pageItemIds,
      );
      if (nextCommitted === null) {
        dashboardPerfNoteIntersect(dashboardPerfActiveRunId(), false);
        return;
      }
      dashboardPerfNoteIntersect(
        dashboardPerfActiveRunId(),
        prevCommittedLen > 0 && nextCommitted.length === 0,
      );
      const nextCommittedIds = nextCommitted.map((item) => item.id);
      // Defer cover publish until applyListSnapshot so items+covers paint once
      // (same #855 hazard: useSyncExternalStore vs useState — flushSync).
      list.covers.intersect(nextCommittedIds, { deferPublish: true });
      revealHeldListPaint({
        requestVersion,
        getCurrentVersion: () => list.requestVersionRef.current,
        covers: list.covers,
        flushSync,
        applyCommitted: () => {
          list.applyListSnapshot({
            itemIds: list.itemIdsRef.current,
            itemsById: list.itemsByIdRef.current,
            bodyStamps: list.bodyStampsRef.current,
            streamEndOffset: list.streamEndOffsetRef.current,
            totalCount: list.totalCountRef.current,
            committedItems: nextCommitted,
            committedTotalCount: list.totalCountRef.current,
            covers: list.covers.getMaps(),
          });
        },
      });
    },
    streamSlice,
  });
}
