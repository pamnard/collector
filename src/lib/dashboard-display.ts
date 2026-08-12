import type { DashboardIndexPage, IndexQueryResult } from "@collector/api";
import type { ItemFile } from "@collector/shared";

/** Map ItemsPort.queryIndex result to the dashboard page shape used by the hook. */
export function mapIndexQueryResult(
  result: IndexQueryResult,
): DashboardIndexPage {
  return {
    itemIds: result.ids,
    stamps: result.stamps,
    totalCount: result.total,
    offset: result.offset,
  };
}

/**
 * Drain a hydrate/async body stream into `onItem`.
 * Callers abort via the signal passed into `hydrate`.
 */
export async function collectHydratedItems(
  items: AsyncIterable<ItemFile>,
  onItem: (item: ItemFile) => void,
): Promise<void> {
  for await (const item of items) {
    onItem(item);
  }
}

/** Leading-edge throttle used for IndexPort-driven dashboard republish (#367). */
export function createThrottledPublisher(
  fn: () => void,
  intervalMs: number,
): { schedule: () => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    fn();
  };

  return {
    schedule() {
      const elapsed = Date.now() - lastRun;
      if (elapsed >= intervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, intervalMs - elapsed);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** Ordered dashboard cards for the current stream window. */
export function orderDashboardItems(
  itemIds: string[],
  itemsById: ReadonlyMap<string, ItemFile>,
  streamEndOffset: number,
): ItemFile[] {
  const ordered: ItemFile[] = [];
  for (const id of itemIds.slice(0, streamEndOffset)) {
    const item = itemsById.get(id);
    if (item) {
      ordered.push(item);
    }
  }
  return ordered;
}

/**
 * True when the prefetch window is fully materialized (or intentionally empty).
 * Used to avoid committing a partial/wrong slice as the final display set.
 */
export function isDashboardPrefetchWindowReady(
  itemIds: string[],
  itemsById: ReadonlyMap<string, ItemFile>,
  streamEndOffset: number,
): boolean {
  if (itemIds.length === 0) {
    return streamEndOffset === 0;
  }
  if (streamEndOffset <= 0) {
    return false;
  }
  const end = Math.min(streamEndOffset, itemIds.length);
  for (let i = 0; i < end; i++) {
    if (!itemsById.has(itemIds[i]!)) {
      return false;
    }
  }
  return true;
}

export function itemIdsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((id, index) => id === right[index])
  );
}

/** Merge a streamed chunk into itemsById with one Map clone. */
export function mergeStreamedItemsById(
  current: ReadonlyMap<string, ItemFile>,
  pending: ReadonlyMap<string, ItemFile>,
): Map<string, ItemFile> {
  const next = new Map(current);
  for (const [id, item] of pending) {
    next.set(id, item);
  }
  return next;
}

export function shouldApplyDashboardStreamBatch(
  currentRequestVersion: number,
  batchRequestVersion: number,
  pendingSize: number,
): boolean {
  return currentRequestVersion === batchRequestVersion && pendingSize > 0;
}
