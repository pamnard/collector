import { createAsyncQueue } from "../util/concurrency.js";

/**
 * Serialize all tags.json mutations for one vault path (#935).
 * ensureTagsByName and catalog prune/reconcile share this chain so a concurrent
 * ensure cannot be clobbered by a prune rewrite (and vice versa).
 */
const tagCatalogQueues = new Map<string, ReturnType<typeof createAsyncQueue>>();

export function withTagCatalogLock<T>(
  vaultPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  let queue = tagCatalogQueues.get(vaultPath);
  if (!queue) {
    queue = createAsyncQueue();
    tagCatalogQueues.set(vaultPath, queue);
  }
  return queue.enqueue(fn);
}
