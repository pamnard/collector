/**
 * Shared cover-path resolve flight for dashboard commit (#657 / #668).
 * Same-version waiters share one in-flight promise so sync republish does
 * not abort covers already resolving.
 */

import type { ItemFile } from "@collector/shared";
import type { UiSessionThumbnailResolveProgressiveOptions } from "@collector/api";
import {
  coverMapsNeedsResolve,
  coverMapsStripStickyNulls,
  itemCoverStamp,
  type CoverMaps,
} from "./cover-maps.ts";
import {
  createCoverPathCommitBatcher,
  type CoverPathCommitBatcher,
} from "./cover-path-commit-batcher.ts";

export type CoverFlightSlot = {
  version: number;
  promise: Promise<void>;
  controller: AbortController;
  batcher: CoverPathCommitBatcher;
} | null;

export type ResolveCoverPathsProgressive = (
  items: ItemFile[],
  options: UiSessionThumbnailResolveProgressiveOptions,
) => Promise<void>;

export type RunCoverPathFlightOptions = {
  requestVersion: number;
  getRequestVersion: () => number;
  orderedItems: ItemFile[];
  getOrderedIds: () => string[];
  getMaps: () => CoverMaps;
  commit: (maps: CoverMaps) => void;
  getFlight: () => CoverFlightSlot;
  setFlight: (flight: CoverFlightSlot) => void;
  resolveProgressive: ResolveCoverPathsProgressive;
  scheduleFlush?: (flush: () => void) => () => void;
};

export async function runCoverPathFlight(
  options: RunCoverPathFlightOptions,
): Promise<void> {
  const { requestVersion, resolveProgressive } = options;

  // Sticky null is terminal for needsResolve. Any flight re-opens those
  // holes so disk can win after generateCover / softRefresh (#871).
  {
    const stripped = coverMapsStripStickyNulls(
      options.getMaps(),
      options.orderedItems,
    );
    if (stripped.stripped) {
      options.commit(stripped.maps);
    }
  }

  const collectNeedsResolve = () => {
    const maps = options.getMaps();
    return options.orderedItems.filter((item) =>
      coverMapsNeedsResolve(maps, item),
    );
  };

  // Same-version waiters share one flight so sync republish does not abort
  // in-flight covers (#657).
  while (true) {
    if (options.getRequestVersion() !== requestVersion) {
      return;
    }
    const needsResolve = collectNeedsResolve();
    if (!needsResolve.length) {
      return;
    }

    const existingFlight = options.getFlight();
    if (existingFlight && existingFlight.version === requestVersion) {
      await existingFlight.promise;
      continue;
    }

    existingFlight?.batcher.cancel();
    existingFlight?.controller.abort();

    const coverController = new AbortController();
    const stampById = new Map(
      needsResolve.map((item) => [item.id, itemCoverStamp(item)]),
    );
    const coverBatcher = createCoverPathCommitBatcher({
      requestVersion,
      getRequestVersion: options.getRequestVersion,
      isAborted: () => coverController.signal.aborted,
      getOrderedIds: options.getOrderedIds,
      getMaps: options.getMaps,
      commit: options.commit,
      scheduleFlush: options.scheduleFlush,
    });

    const flightPromise = (async () => {
      await resolveProgressive(needsResolve, {
        signal: coverController.signal,
        onResolved: (id, path, size) => {
          const stamp = stampById.get(id);
          if (stamp === undefined) {
            return;
          }
          coverBatcher.enqueue(id, path, stamp, size);
        },
      });
      coverBatcher.flush();
    })();

    options.setFlight({
      version: requestVersion,
      promise: flightPromise,
      controller: coverController,
      batcher: coverBatcher,
    });
    try {
      await flightPromise;
    } finally {
      if (options.getFlight()?.promise === flightPromise) {
        options.setFlight(null);
      }
    }
    break;
  }
}
