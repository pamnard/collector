/**
 * Coalesce progressive cover onResolved into fewer React Map commits (#657).
 * Default schedule is rAF; tests inject a manual scheduler.
 */

import {
  mergeCommittedThumbnailPaths,
  mergeCommittedThumbnailStamps,
  thumbnailPathsEqual,
} from "./dashboard-commit.ts";

export type CoverPathCommitBatcher = {
  enqueue: (id: string, path: string | null, stamp: string) => void;
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
  commit: (
    paths: Map<string, string | null>,
    stamps: Map<string, string>,
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
      return;
    }
    if (pendingPaths.size === 0) {
      return;
    }

    const resolvedPaths = pendingPaths;
    const resolvedStamps = pendingStamps;
    pendingPaths = new Map();
    pendingStamps = new Map();

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
    if (thumbnailPathsEqual(options.getPaths(), mergedPaths, orderedIds)) {
      return;
    }
    options.commit(mergedPaths, mergedStamps);
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
    enqueue(id, path, stamp) {
      if (!canApply()) {
        return;
      }
      pendingPaths.set(id, path);
      pendingStamps.set(id, stamp);
      schedule();
    },
    flush() {
      flushNow();
    },
    cancel() {
      alive = false;
      clearSchedule();
      pendingPaths = new Map();
      pendingStamps = new Map();
    },
  };
}
