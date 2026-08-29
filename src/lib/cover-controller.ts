/**
 * Dashboard cover orchestration (#874): owns CoverMaps SoT, flight, refresh,
 * sticky-null probes. List paint / cold reveal stay in list state.
 */

import type { ItemFile } from "@collector/shared";
import {
  coverMapsClone,
  coverMapsIntersect,
  coverMapsNeedsResolve,
  coverMapsUpsertPath,
  emptyCoverMaps,
  itemCoverStamp,
  orderedIds,
  type CoverMaps,
} from "./cover-maps.ts";
import {
  runCoverPathFlight,
  type CoverFlightSlot,
  type ResolveCoverPathsProgressive,
} from "./dashboard-cover-flight.ts";
import {
  bumpCoverRefreshGeneration,
  isCoverRefreshGenerationCurrent,
  notePendingCoverRefresh,
  takePendingCoverRefreshesForItems,
} from "./dashboard-cover-refresh.ts";

/** Anonymous defer (intersect/publish in one sync turn; no version). */
const ANON_DEFER_VERSION = -1;

export type CoverDeferOpts = {
  deferPublish?: boolean;
  /** When set, cancelDeferredPublish(version) only clears this hold. */
  requestVersion?: number;
};

export type CoverControllerDeps = {
  resolveProgressive: ResolveCoverPathsProgressive;
  getRequestVersion: () => number;
  getQueryKey: () => string;
  getItem: (id: string) => ItemFile | undefined;
  /**
   * Persist maps to query cache when publishing (not React). Called only when
   * writing through with persistMeta (including silent upgrades during defer).
   */
  persistMaps?: (
    maps: CoverMaps,
    meta: { flightKey: string; flightVersion: number },
  ) => void;
};

export type CoverController = {
  /** Live SoT (orchestration / flight / list decisions). */
  getMaps: () => CoverMaps;
  /** Last maps emitted to React (cold hold may lag live). */
  getPublishedMaps: () => CoverMaps;
  subscribe: (listener: () => void) => () => void;
  /** Replace SoT (hydrate / prune / clear). */
  replaceMaps: (maps: CoverMaps, opts?: CoverDeferOpts) => void;
  /** Emit deferred live maps to subscribers (no-op if not holding). */
  publish: () => void;
  /**
   * Always sync published ← live and emit. Cold reveal must use this so a
   * stale cancelDeferredPublish cannot leave UI without covers.
   */
  flushPublished: () => void;
  /**
   * End a deferred hold without emitting (stale request / abort).
   * When `requestVersion` is passed, only that version's hold is cleared.
   */
  cancelDeferredPublish: (requestVersion?: number) => void;
  intersect: (orderedIds: string[], opts?: CoverDeferOpts) => void;
  clear: (opts?: CoverDeferOpts) => void;
  beginFlight: (
    requestVersion: number,
    orderedItems: ItemFile[],
    options?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
  ) => Promise<void>;
  refresh: (itemId: string) => void;
  abort: () => void;
  /** Track displayed maps for path→null downgrade probes (reads live SoT). */
  noteDisplayedMaps: (items: ItemFile[]) => void;
  /**
   * Refresh sticky nulls for the given window. Call-site owns once-per-mount
   * (#871: WarmGridShell remount must re-probe; controller outlives the shell).
   */
  probeStickyNulls: (items: ItemFile[]) => void;
  ensureFlightForHoles: (orderedItems: ItemFile[]) => void;
};

export function createCoverController(
  deps: CoverControllerDeps,
  initialMaps: CoverMaps = emptyCoverMaps(),
): CoverController {
  let liveMaps: CoverMaps = coverMapsClone(initialMaps);
  let publishedMaps: CoverMaps = coverMapsClone(initialMaps);
  let flight: CoverFlightSlot = null;
  const coverRefreshGeneration = new Map<string, number>();
  const pendingCoverRefresh = new Set<string>();
  const listeners = new Set<() => void>();
  let prevDisplayedPaths = new Map<string, string | null>(liveMaps.paths);
  /** null = not holding; else requestVersion or ANON_DEFER_VERSION. */
  let deferredForVersion: number | null = null;

  function isHolding(): boolean {
    return deferredForVersion !== null;
  }

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function syncPublishedFromLive(): void {
    deferredForVersion = null;
    publishedMaps = coverMapsClone(liveMaps);
    emit();
  }

  function applyMaps(
    next: CoverMaps,
    opts?: {
      deferPublish?: boolean;
      requestVersion?: number;
      persistMeta?: { flightKey: string; flightVersion: number };
    },
  ): void {
    liveMaps = next;
    if (opts?.persistMeta) {
      deps.persistMaps?.(liveMaps, opts.persistMeta);
    }
    if (opts?.deferPublish) {
      if (opts.requestVersion !== undefined) {
        deferredForVersion = opts.requestVersion;
      } else if (deferredForVersion === null) {
        deferredForVersion = ANON_DEFER_VERSION;
      }
      return;
    }
    if (isHolding()) {
      // Already holding React: keep silent until publish/flush/cancel.
      return;
    }
    publishedMaps = coverMapsClone(liveMaps);
    emit();
  }

  function abort(): void {
    flight?.batcher.cancel();
    flight?.controller.abort();
    flight = null;
  }

  function flushPending(orderedItems: ItemFile[]): void {
    const ready = takePendingCoverRefreshesForItems(
      pendingCoverRefresh,
      orderedItems.map((item) => item.id),
    );
    for (const id of ready) {
      refresh(id);
    }
  }

  function refresh(itemId: string): void {
    const item = deps.getItem(itemId);
    if (!item) {
      notePendingCoverRefresh(pendingCoverRefresh, itemId);
      return;
    }
    const generation = bumpCoverRefreshGeneration(
      coverRefreshGeneration,
      itemId,
    );
    const requestVersion = deps.getRequestVersion();
    const cacheKeyForFlight = deps.getQueryKey();

    // Do not clear maps before resolve (#871).
    void deps.resolveProgressive([item], {
      onResolved: (id, path, size) => {
        if (id !== itemId) {
          return;
        }
        if (deps.getRequestVersion() !== requestVersion) {
          return;
        }
        if (
          !isCoverRefreshGenerationCurrent(
            coverRefreshGeneration,
            itemId,
            generation,
          )
        ) {
          return;
        }
        if (path == null) {
          return;
        }
        const liveItem = deps.getItem(itemId);
        if (!liveItem) {
          return;
        }
        const stamp = itemCoverStamp(liveItem);
        applyMaps(coverMapsUpsertPath(liveMaps, itemId, path, stamp, size), {
          persistMeta: {
            flightKey: cacheKeyForFlight,
            flightVersion: requestVersion,
          },
        });
      },
    });
  }

  function beginFlight(
    requestVersion: number,
    orderedItems: ItemFile[],
    options?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
  ): Promise<void> {
    flushPending(orderedItems);
    const blockOnCovers = options?.blockOnCovers ?? false;
    const deferUiCommit = options?.deferUiCommit ?? false;
    const cacheKeyForFlight = deps.getQueryKey();

    if (deferUiCommit) {
      deferredForVersion = requestVersion;
    }

    return runCoverPathFlight({
      requestVersion,
      getRequestVersion: deps.getRequestVersion,
      orderedItems,
      getOrderedIds: () => orderedIds(orderedItems),
      getMaps: () => liveMaps,
      commit: (next) => {
        applyMaps(next, {
          deferPublish: deferUiCommit,
          requestVersion: deferUiCommit ? requestVersion : undefined,
          persistMeta: deferUiCommit
            ? undefined
            : {
                flightKey: cacheKeyForFlight,
                flightVersion: requestVersion,
              },
        });
      },
      getFlight: () => flight,
      setFlight: (next) => {
        flight = next;
      },
      resolveProgressive: deps.resolveProgressive,
      scheduleFlush: blockOnCovers ? () => () => {} : undefined,
    });
  }

  function noteDisplayedMaps(items: ItemFile[]): void {
    const next = liveMaps;
    for (const item of items) {
      const path = next.paths.get(item.id);
      const was = prevDisplayedPaths.get(item.id);
      if (path === null && was != null) {
        refresh(item.id);
      }
    }
    prevDisplayedPaths = new Map(next.paths);
  }

  function probeStickyNulls(items: ItemFile[]): void {
    for (const item of items) {
      if (liveMaps.paths.get(item.id) === null) {
        refresh(item.id);
      }
    }
  }

  function ensureFlightForHoles(orderedItems: ItemFile[]): void {
    flushPending(orderedItems);
    const liveNeeds = orderedItems.some((item) =>
      coverMapsNeedsResolve(liveMaps, item),
    );
    const publishedNeeds = orderedItems.some((item) =>
      coverMapsNeedsResolve(publishedMaps, item),
    );
    // Stale cancel left live complete but published empty — heal UI.
    if (publishedNeeds && !liveNeeds) {
      syncPublishedFromLive();
      return;
    }
    if (!liveNeeds) {
      return;
    }
    const requestVersion = deps.getRequestVersion();
    if (flight && flight.version === requestVersion) {
      return;
    }
    void beginFlight(requestVersion, orderedItems);
  }

  return {
    getMaps: () => liveMaps,
    getPublishedMaps: () => publishedMaps,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replaceMaps(next, opts) {
      applyMaps(next, {
        deferPublish: opts?.deferPublish,
        requestVersion: opts?.requestVersion,
      });
    },
    publish() {
      if (!isHolding()) {
        return;
      }
      syncPublishedFromLive();
    },
    flushPublished() {
      syncPublishedFromLive();
    },
    cancelDeferredPublish(requestVersion) {
      if (!isHolding()) {
        return;
      }
      if (
        requestVersion !== undefined &&
        deferredForVersion !== requestVersion
      ) {
        return;
      }
      deferredForVersion = null;
    },
    intersect(ids, opts) {
      applyMaps(coverMapsIntersect(liveMaps, ids), {
        deferPublish: opts?.deferPublish,
        requestVersion: opts?.requestVersion,
      });
    },
    clear(opts) {
      applyMaps(emptyCoverMaps(), {
        deferPublish: opts?.deferPublish,
        requestVersion: opts?.requestVersion,
      });
    },
    beginFlight,
    refresh,
    abort,
    noteDisplayedMaps,
    probeStickyNulls,
    ensureFlightForHoles,
  };
}

/** Seed CoverMaps from a cache entry (#874). */
export function coverMapsFromCacheEntry(entry: {
  covers: CoverMaps;
}): CoverMaps {
  return coverMapsClone(entry.covers);
}
