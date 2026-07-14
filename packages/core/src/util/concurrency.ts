/** Limits parallel async work; independent of caller batch/window size. */
export const DISK_ITEM_READ_CONCURRENCY = 16;

/** SQLite write batch size during background index sync; yields between batches. */
export const INDEX_SYNC_WRITE_BATCH = 32;

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function runWithConcurrency<T>(
  count: number,
  concurrency: number,
  fn: (index: number) => Promise<T>,
): Promise<T[]> {
  if (count === 0) {
    return [];
  }

  const results: T[] = new Array(count);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= count) {
        return;
      }
      results[index] = await fn(index);
    }
  }

  const workerCount = Math.min(concurrency, count);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
