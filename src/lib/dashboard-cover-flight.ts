/**
 * Shared cover-path resolve flight for dashboard commit (#657 / #668).
 * Same-version waiters share one in-flight promise so sync republish does
 * not abort covers already resolving.
 */

import type { ItemFile } from "@collector/shared";
import type {
  ItemThumbnailPixelSize,
  UiSessionThumbnailResolveProgressiveOptions,
} from "@collector/api";
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
  getSizes: () => Map<string, ItemThumbnailPixelSize | null>;
  commit: (
    paths: Map<string, string | null>,
    stamps: Map<string, string>,
    sizes: Map<string, ItemThumbnailPixelSize | null>,
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

  // Sticky null is terminal for coverNeedsResolve. Any flight re-opens those
  // holes so disk can win after generateCover / softRefresh (#871).
  {
    const paths = new Map(options.getPaths());
    const stamps = new Map(options.getStamps());
    const sizes = new Map(options.getSizes());
    let stripped = false;
    for (const item of options.orderedItems) {
      if (paths.get(item.id) !== null) {
        continue;
      }
      if (!paths.has(item.id)) {
        continue;
      }
      paths.delete(item.id);
      stamps.delete(item.id);
      sizes.delete(item.id);
      stripped = true;
    }
    if (stripped) {
      options.commit(paths, stamps, sizes);
    }
  }

  const collectNeedsResolve = () =>
    options.orderedItems.filter((item) =>
      coverNeedsResolve(
        item,
        options.getPaths(),
        options.getStamps(),
        options.getSizes(),
      ),
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
      getSizes: options.getSizes,
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
