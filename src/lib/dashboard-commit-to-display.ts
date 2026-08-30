/**
 * Dashboard working→committed paint orchestration (#416).
 * Pure of React: hook supplies snapshot + sink adapters.
 */

import type { ItemFile } from "@collector/shared";
import {
  bodyStampsForOrderedIds,
  itemsBodiesEqual,
  orderedIds,
  shouldSkipCommitPaint,
  shouldSkipEmptyCommit,
} from "./dashboard-commit.ts";
import {
  revealHeldListPaint,
  type RevealHeldListPaintCovers,
} from "./dashboard-cold-reveal.ts";
import {
  coverMapsNeedsResolve,
  type CoverMaps,
} from "./cover-maps.ts";
import {
  isDashboardPrefetchWindowReady,
  itemIdsEqual,
  orderDashboardItems,
} from "./dashboard-display.ts";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfEndPhase,
  dashboardPerfNoteItemCount,
} from "./dashboard-perf.ts";

export type DashboardCommitCoverIntersectOpts = {
  deferPublish?: boolean;
  requestVersion?: number;
};

export type DashboardCommitCovers = RevealHeldListPaintCovers & {
  intersect: (
    orderedIds: string[],
    opts?: DashboardCommitCoverIntersectOpts,
  ) => void;
  getMaps: () => CoverMaps;
};

export type DashboardCommitStartCoverPathFlight = (
  requestVersion: number,
  orderedItems: ItemFile[],
  options?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
) => Promise<void>;

export type DashboardCommitToDisplaySink = {
  applyImmediateCommitted: (
    ordered: ItemFile[],
    nextTotal: number,
    hasMore: boolean,
  ) => void;
  /** React setState only — invoked inside flushSync during held reveal. */
  applyHeldCommitted: (
    ordered: ItemFile[],
    nextTotal: number,
    hasMore: boolean,
  ) => void;
  /** Refs after a successful held reveal (not on cancelled-stale). */
  syncCommittedRefs: (ordered: ItemFile[], nextTotal: number) => void;
  setCommittedBodyStamps: (stamps: Map<string, string>) => void;
  writeQueryCache: (
    ids: string[],
    byId: Map<string, ItemFile>,
    end: number,
    nextTotal: number,
  ) => void;
  onHeldCoverFlightError: (err: unknown) => void;
};

export type RunDashboardCommitToDisplayInput = {
  requestVersion: number;
  blockOnCovers: boolean;
  ids: string[];
  byId: Map<string, ItemFile>;
  end: number;
  nextTotal: number;
  prevItems: ItemFile[];
  prevTotal: number;
  bodyStamps: ReadonlyMap<string, string>;
  committedBodyStamps: ReadonlyMap<string, string>;
  covers: DashboardCommitCovers;
  startCoverPathFlight: DashboardCommitStartCoverPathFlight;
  flushSync: (fn: () => void) => void;
  getCurrentVersion: () => number;
  sink: DashboardCommitToDisplaySink;
};

export type DashboardCommitToDisplayResult =
  | "done"
  | "skipped"
  | "cancelled-stale";

export async function runDashboardCommitToDisplay(
  input: RunDashboardCommitToDisplayInput,
): Promise<DashboardCommitToDisplayResult> {
  const {
    requestVersion,
    blockOnCovers,
    ids,
    byId,
    end,
    nextTotal,
    prevItems,
    prevTotal,
    bodyStamps,
    committedBodyStamps,
    covers,
    startCoverPathFlight,
    flushSync,
    getCurrentVersion,
    sink,
  } = input;

  if (getCurrentVersion() !== requestVersion) {
    return "skipped";
  }

  if (!isDashboardPrefetchWindowReady(ids, byId, end)) {
    console.warn(
      "[dashboard] prefetch window incomplete at commit; revealing anyway",
      {
        idCount: ids.length,
        bodyCount: byId.size,
        streamEndOffset: end,
      },
    );
  }

  const ordered = orderDashboardItems(ids, byId, end);
  if (shouldSkipEmptyCommit(ordered.length, prevItems.length, nextTotal)) {
    return "skipped";
  }

  const prevOrderedIds = orderedIds(prevItems);
  const nextOrderedIds = orderedIds(ordered);
  // Folder / filter id-set change must not publish empty maps while the new
  // list is already on screen (#913) — same held paint as cold blockOnCovers.
  const orderedIdsChanged = !itemIdsEqual(prevOrderedIds, nextOrderedIds);
  const holdForCovers = blockOnCovers || orderedIdsChanged;
  const skipPaint = shouldSkipCommitPaint({
    prevOrderedIds,
    nextOrderedIds,
    prevTotalCount: prevTotal,
    nextTotalCount: nextTotal,
    prevBodyStamps: committedBodyStamps,
    nextBodyStamps: bodyStamps,
  });

  let heldListPaint = false;

  if (!skipPaint) {
    const itemsUnchanged =
      !orderedIdsChanged &&
      prevTotal === nextTotal &&
      itemsBodiesEqual(prevItems, ordered);

    if (!itemsUnchanged) {
      // Seed flight maps; defer React list paint until covers are ready (#855 / #913).
      covers.intersect(nextOrderedIds, {
        deferPublish: holdForCovers,
        requestVersion: holdForCovers ? requestVersion : undefined,
      });
      sink.setCommittedBodyStamps(
        bodyStampsForOrderedIds(bodyStamps, nextOrderedIds),
      );

      if (holdForCovers) {
        heldListPaint = true;
      } else {
        const perfRunId = dashboardPerfActiveRunId();
        dashboardPerfBeginPhase(perfRunId, "commitList");
        sink.applyImmediateCommitted(ordered, nextTotal, end < nextTotal);
        dashboardPerfEndPhase(perfRunId, "commitList");
        dashboardPerfNoteItemCount(perfRunId, ordered.length);
        sink.writeQueryCache(ids, byId, end, nextTotal);
      }
    } else {
      sink.setCommittedBodyStamps(
        bodyStampsForOrderedIds(bodyStamps, nextOrderedIds),
      );
      sink.writeQueryCache(ids, byId, end, nextTotal);
    }
  }

  const coverMaps = covers.getMaps();
  const coversNeedResolve = ordered.some((item) =>
    coverMapsNeedsResolve(coverMaps, item),
  );
  if (skipPaint && !coversNeedResolve && !heldListPaint) {
    return "skipped";
  }

  if (coversNeedResolve || holdForCovers) {
    try {
      await startCoverPathFlight(requestVersion, ordered, {
        blockOnCovers: holdForCovers,
        deferUiCommit: heldListPaint,
      });
    } catch (err: unknown) {
      if (!heldListPaint) {
        throw err;
      }
      sink.onHeldCoverFlightError(err);
    }
  }

  if (heldListPaint) {
    const perfRunId = dashboardPerfActiveRunId();
    dashboardPerfBeginPhase(perfRunId, "commitList");
    const revealed = revealHeldListPaint({
      requestVersion,
      getCurrentVersion,
      covers,
      flushSync,
      applyCommitted: () => {
        sink.applyHeldCommitted(ordered, nextTotal, end < nextTotal);
      },
    });
    if (revealed === "cancelled-stale") {
      dashboardPerfEndPhase(perfRunId, "commitList");
      return "cancelled-stale";
    }
    sink.syncCommittedRefs(ordered, nextTotal);
    dashboardPerfEndPhase(perfRunId, "commitList");
    dashboardPerfNoteItemCount(perfRunId, ordered.length);
    sink.writeQueryCache(ids, byId, end, nextTotal);
  }

  return "done";
}
