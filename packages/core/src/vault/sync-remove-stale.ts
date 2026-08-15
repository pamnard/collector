import type {
  ReconcileFingerprint,
  SyncReport,
  VaultContext,
} from "../adapters/types.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";

export async function removeStaleIndexedItems(args: {
  ctx: VaultContext;
  indexedIds: Set<string>;
  diskItemIds: Set<string>;
  report: SyncReport;
}): Promise<void> {
  const { ctx, indexedIds, diskItemIds, report } = args;
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

export async function persistReconcileFingerprintIfClean(args: {
  ctx: VaultContext;
  vaultId: string;
  currentFingerprint: ReconcileFingerprint;
  report: SyncReport;
}): Promise<void> {
  const { ctx, vaultId, currentFingerprint, report } = args;
  if (report.errors.length === 0) {
    await ctx.index.setReconcileFingerprint(vaultId, currentFingerprint);
  }
}
