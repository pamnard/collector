/**
 * Shared cover-path resolve flight for dashboard commit (#657 / #668).
 * Same-version waiters share one in-flight promise so sync republish does
 * not abort covers already resolving.
 */

import type { ItemFile } from "@collector/shared";
import type { UiSessionThumbnailResolveProgressiveOptions } from "@collector/api";
import {
  coverNeedsResolve,
  itemCoverStamp,
} from "./dashboard-commit.ts";
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
  getPaths: () => Map<string, string | null>;
  getStamps: () => Map<string, string>;
  commit: (
    paths: Map<string, string | null>,
    stamps: Map<string, string>,
  ) => void;
  getFlight: () => CoverFlightSlot;
  setFlight: (flight: CoverFlightSlot) => void;
  resolveProgressive: ResolveCoverPathsProgressive;
  scheduleFlush?: (flush: () => void) => () => void;
};

export async function runCoverPathFlight(
  options: RunCoverPathFlightOptions,
): Promise<void> {
  const { requestVersion, resolveProgressive } = options;

  const collectNeedsResolve = () =>
    options.orderedItems.filter((item) =>
      coverNeedsResolve(item, options.getPaths(), options.getStamps()),
    );

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
      getPaths: options.getPaths,
      getStamps: options.getStamps,
      commit: options.commit,
      scheduleFlush: options.scheduleFlush,
    });

    const flightPromise = (async () => {
      await resolveProgressive(needsResolve, {
        signal: coverController.signal,
        onResolved: (id, path) => {
          const stamp = stampById.get(id);
          if (stamp === undefined) {
            return;
          }
          coverBatcher.enqueue(id, path, stamp);
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
