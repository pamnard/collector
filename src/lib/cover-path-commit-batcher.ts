/**
 * Coalesce progressive cover onResolved into fewer React Map commits (#657).
 * Default schedule is rAF; tests inject a manual scheduler.
 */

import type { ItemThumbnailPixelSize } from "@collector/api";
import {
  mergeCommittedThumbnailPaths,
  mergeCommittedThumbnailSizes,
  mergeCommittedThumbnailStamps,
  thumbnailPathsEqual,
  thumbnailSizesEqual,
} from "./dashboard-commit.ts";

export type CoverPathCommitBatcher = {
  enqueue: (
    id: string,
    path: string | null,
    stamp: string,
    size: ItemThumbnailPixelSize | null,
  ) => void;
  flush: () => void;
  cancel: () => void;
};

export type CoverPathCommitBatcherOptions = {
  requestVersion: number;
  getRequestVersion: () => number;
  isAborted: () => boolean;
  getOrderedIds: () => string[];
  getPaths: () => Map<string, string | null>;
  getStamps: () => Map<string, string>;
  getSizes: () => Map<string, ItemThumbnailPixelSize | null>;
  commit: (
    paths: Map<string, string | null>,
    stamps: Map<string, string>,
    sizes: Map<string, ItemThumbnailPixelSize | null>,
  ) => void;
  /** Schedule a flush; return cancel. Defaults to requestAnimationFrame. */
  scheduleFlush?: (flush: () => void) => () => void;
};

function defaultScheduleFlush(flush: () => void): () => void {
  const handle = requestAnimationFrame(() => {
    flush();
  });
  return () => {
    cancelAnimationFrame(handle);
  };
}

export function createCoverPathCommitBatcher(
  options: CoverPathCommitBatcherOptions,
): CoverPathCommitBatcher {
  const scheduleFlush = options.scheduleFlush ?? defaultScheduleFlush;
  let pendingPaths = new Map<string, string | null>();
  let pendingStamps = new Map<string, string>();
  let pendingSizes = new Map<string, ItemThumbnailPixelSize | null>();
  let cancelScheduled: (() => void) | null = null;
  let alive = true;

  const canApply = (): boolean =>
    alive &&
    options.getRequestVersion() === options.requestVersion &&
    !options.isAborted();

  const clearSchedule = () => {
    if (cancelScheduled) {
      cancelScheduled();
      cancelScheduled = null;
    }
  };

  const flushNow = () => {
    clearSchedule();
    if (!canApply()) {
      pendingPaths = new Map();
      pendingStamps = new Map();
      pendingSizes = new Map();
      return;
    }
    if (pendingPaths.size === 0) {
      return;
    }

    const resolvedPaths = pendingPaths;
    const resolvedStamps = pendingStamps;
    const resolvedSizes = pendingSizes;
    pendingPaths = new Map();
    pendingStamps = new Map();
    pendingSizes = new Map();

    const orderedIds = options.getOrderedIds();
    const mergedPaths = mergeCommittedThumbnailPaths(
      options.getPaths(),
      resolvedPaths,
      orderedIds,
    );
    const mergedStamps = mergeCommittedThumbnailStamps(
      options.getStamps(),
      resolvedStamps,
      orderedIds,
    );
    const mergedSizes = mergeCommittedThumbnailSizes(
      options.getSizes(),
      resolvedSizes,
      orderedIds,
    );
    if (
      thumbnailPathsEqual(options.getPaths(), mergedPaths, orderedIds) &&
      thumbnailSizesEqual(options.getSizes(), mergedSizes, orderedIds)
    ) {
      return;
    }
    options.commit(mergedPaths, mergedStamps, mergedSizes);
  };

  const schedule = () => {
    if (!canApply() || cancelScheduled) {
      return;
    }
    cancelScheduled = scheduleFlush(() => {
      cancelScheduled = null;
      flushNow();
    });
  };

  return {
    enqueue(id, path, stamp, size) {
      if (!canApply()) {
        return;
      }
      pendingPaths.set(id, path);
      pendingStamps.set(id, stamp);
      pendingSizes.set(id, size);
      schedule();
    },
    flush() {
      flushNow();
    },
    cancel() {
      // Commit already-resolved rows before dying when this request is still
      // live — abort used to drop pending and leave cover-map holes until
      // hard refresh (Teapot / folder switch).
      if (
        alive &&
        options.getRequestVersion() === options.requestVersion &&
        !options.isAborted()
      ) {
        flushNow();
      }
      alive = false;
      clearSchedule();
      pendingPaths = new Map();
      pendingStamps = new Map();
      pendingSizes = new Map();
    },
  };
}
