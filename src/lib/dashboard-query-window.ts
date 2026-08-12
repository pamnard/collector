import { itemIdsEqual } from "./dashboard-display.ts";

export function computePreservedStreamEnd(
  previousEnd: number,
  idCount: number,
  prefetchSize: number,
): number {
  return previousEnd > 0
    ? Math.min(previousEnd, idCount)
    : Math.min(prefetchSize, idCount);
}

export type ApplyOffsetZeroPagePlan =
  | { kind: "empty"; preservedEnd: 0; needsStream: false; idsToKeepBodies: [] }
  | {
      kind: "ids-changed";
      preservedEnd: number;
      needsStream: true;
      idsToKeepBodies: string[];
    }
  | {
      kind: "ids-same";
      preservedEnd: number;
      needsStream: boolean;
      idsToKeepBodies: string[];
    };

export function planApplyOffsetZeroPage(input: {
  pageItemIds: string[];
  pageStamps: string[];
  previousIds: string[];
  previousStreamEnd: number;
  prefetchSize: number;
  itemsByIdHas: (id: string) => boolean;
  cachedStampFor: (id: string) => string | undefined;
}): ApplyOffsetZeroPagePlan {
  const {
    pageItemIds,
    pageStamps,
    previousIds,
    previousStreamEnd,
    prefetchSize,
    itemsByIdHas,
    cachedStampFor,
  } = input;

  if (!pageItemIds.length) {
    return {
      kind: "empty",
      preservedEnd: 0,
      needsStream: false,
      idsToKeepBodies: [],
    };
  }

  if (pageStamps.length !== pageItemIds.length) {
    throw new Error(
      `pageStamps length ${pageStamps.length} !== pageItemIds length ${pageItemIds.length}`,
    );
  }

  const preservedEnd = computePreservedStreamEnd(
    previousStreamEnd,
    pageItemIds.length,
    prefetchSize,
  );

  if (!itemIdsEqual(previousIds, pageItemIds)) {
    return {
      kind: "ids-changed",
      preservedEnd,
      needsStream: true,
      idsToKeepBodies: pageItemIds,
    };
  }

  const needsStream = pageItemIds.slice(0, preservedEnd).some((id, index) => {
    if (!itemsByIdHas(id)) {
      return true;
    }
    const cached = cachedStampFor(id);
    if (cached === undefined) {
      return true;
    }
    return cached !== pageStamps[index];
  });

  return {
    kind: "ids-same",
    preservedEnd,
    needsStream,
    idsToKeepBodies: pageItemIds,
  };
}

export type LoadMorePlan =
  | { kind: "noop" }
  | { kind: "stream-only" }
  | { kind: "fetch-ids-then-stream" };

export function planLoadMore(input: {
  isLoading: boolean;
  isLoadingMore: boolean;
  streamEndOffset: number;
  loadedCount: number;
  totalCount: number;
  prefetchSize: number;
}): LoadMorePlan {
  const {
    isLoading,
    isLoadingMore,
    streamEndOffset,
    loadedCount,
    totalCount,
    prefetchSize,
  } = input;

  if (isLoading || isLoadingMore) {
    return { kind: "noop" };
  }

  const needsMoreIds = streamEndOffset + prefetchSize > loadedCount;
  const hasUnloadedIds = loadedCount < totalCount;

  if (streamEndOffset >= loadedCount && !hasUnloadedIds) {
    return { kind: "noop" };
  }

  if (needsMoreIds && hasUnloadedIds) {
    return { kind: "fetch-ids-then-stream" };
  }

  return { kind: "stream-only" };
}

export function nextStreamWindow(
  streamEndOffset: number,
  idCount: number,
  prefetchSize: number,
): { offset: number; limit: number; nextEnd: number } {
  const offset = streamEndOffset;
  const limit = Math.min(prefetchSize, idCount - offset);
  return { offset, limit, nextEnd: offset + limit };
}
