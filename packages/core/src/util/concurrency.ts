/** Limits parallel async work; independent of caller batch/window size. */
export const DISK_ITEM_READ_CONCURRENCY = 4;

/** SQLite write batch size during background index sync; yields between batches. */
export const INDEX_SYNC_WRITE_BATCH = 32;

/** Sleep between sync batches so WebView / compositor keep air under plugin IPC. */
export const INDEX_SYNC_YIELD_MS = 16;

/** Yield the event loop; pass ms > 0 for a real sleep (IPC backpressure). */
export function yieldToEventLoop(ms = 0): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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

/**
 * Run work in chunks of `yieldEvery`, yielding `yieldMs` between chunks
 * so plugin-fs / plugin-sql IPC cannot saturate the host.
 */
export async function runWithConcurrencyYielding<T>(
  count: number,
  concurrency: number,
  fn: (index: number) => Promise<T>,
  options: { yieldEvery: number; yieldMs: number },
): Promise<T[]> {
  if (count === 0) {
    return [];
  }

  const { yieldEvery, yieldMs } = options;
  const results: T[] = new Array(count);

  for (let offset = 0; offset < count; offset += yieldEvery) {
    const chunkSize = Math.min(yieldEvery, count - offset);
    const chunk = await runWithConcurrency(chunkSize, concurrency, (i) =>
      fn(offset + i),
    );
    for (let i = 0; i < chunkSize; i += 1) {
      results[offset + i] = chunk[i]!;
    }
    if (offset + chunkSize < count) {
      await yieldToEventLoop(yieldMs);
    }
  }

  return results;
}
