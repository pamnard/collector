import type { VaultContext } from "../../adapters/types.js";
import type { SyncReport } from "../../adapters/types.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../../util/concurrency.js";

export async function removeOrphanedIndexItems(
  ctx: VaultContext,
  diskItemIds: Set<string>,
  indexedIds: Set<string>,
  report: SyncReport,
): Promise<void> {
  let removedBatch = 0;
  for (const indexedId of indexedIds) {
    if (!diskItemIds.has(indexedId)) {
      await ctx.index.deleteItem(indexedId);
      report.removed += 1;
      removedBatch += 1;
      if (removedBatch % INDEX_SYNC_WRITE_BATCH === 0) {
        await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
      }
    }
  }
}
