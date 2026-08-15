import type {
  IndexSyncOptions,
  IndexSyncPhase,
  SyncReport,
  VaultContext,
} from "../adapters/types.js";
import {
  canTakeReconcileFastPath,
  readVaultReconcileFingerprint,
} from "./reconcile-fingerprint.js";
import { listItemRelativePaths } from "./scan.js";
import { classifyAndPatchSyncItems } from "./sync-operations-classify.js";
import { reindexSyncContent } from "./sync-operations-content.js";
import {
  createEmptySyncReport,
  toSyncProgress,
} from "./sync-operations-progress.js";
import { reindexSyncMetadata } from "./sync-operations-reindex.js";
import { removeMissingSyncItems } from "./sync-operations-remove.js";

export async function syncIndexFromFilesystem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  options: IndexSyncOptions = {},
): Promise<SyncReport> {
  const report = createEmptySyncReport();
  const { onProgress, onBatch, onMetadataComplete } = options;
  let phase: IndexSyncPhase = "metadata";

  const emitProgress = (processed: number, total: number) => {
    onProgress?.(toSyncProgress(report, processed, total, phase));
  };

  const emitBatch = (processed: number, total: number) => {
    const progress = toSyncProgress(report, processed, total, phase);
    onProgress?.(progress);
    onBatch?.(progress);
  };

  if (!(await ctx.fs.exists(vaultPath))) {
    const emptyProgress = toSyncProgress(report, 0, 0, phase);
    emitProgress(0, 0);
    await onMetadataComplete?.(emptyProgress);
    return report;
  }

  const diskItemIds = new Set(await listItemRelativePaths(ctx.fs, vaultPath));
  const currentFingerprint = await readVaultReconcileFingerprint(
    ctx.fs,
    vaultPath,
    diskItemIds.size,
  );
  const indexedItems = await ctx.index.listVaultItemSyncMeta(vaultId);
  const storedFingerprint = await ctx.index.getReconcileFingerprint(vaultId);
  const indexMeta = new Map(indexedItems.map((item) => [item.id, item]));
  const indexedIds = new Set(indexedItems.map((item) => item.id));
  const total = diskItemIds.size;

  if (
    canTakeReconcileFastPath({
      storedFingerprint,
      currentFingerprint,
      indexedItemCount: indexedItems.length,
      diskItemCount: diskItemIds.size,
      indexedIds,
      diskItemIds,
    })
  ) {
    report.skipped = total;
    const fastPathProgress = toSyncProgress(report, total, total, phase);
    emitProgress(total, total);
    await onMetadataComplete?.(fastPathProgress);
    onBatch?.(fastPathProgress);
    return report;
  }

  emitProgress(0, total);

  const { reindexQueue, classified, tagMaps } = await classifyAndPatchSyncItems({
    ctx,
    vaultPath,
    vaultId,
    diskItemIds,
    indexMeta,
    report,
  });

  const processedBeforeReindex = classified - reindexQueue.length;
  phase = "metadata";
  emitProgress(processedBeforeReindex, total);

  await reindexSyncMetadata({
    ctx,
    vaultPath,
    vaultId,
    reindexQueue,
    tagMaps,
    report,
    processedBeforeReindex,
    total,
    emitBatch,
  });

  const metadataCompleteProgress = toSyncProgress(
    report,
    processedBeforeReindex + reindexQueue.length,
    total,
    "metadata",
  );
  await onMetadataComplete?.(metadataCompleteProgress);
  if (reindexQueue.length > 0) {
    onBatch?.(metadataCompleteProgress);
  }

  phase = "content";
  await reindexSyncContent({
    ctx,
    vaultPath,
    vaultId,
    reindexQueue,
    tagMaps,
    report,
    emitBatch,
  });

  await removeMissingSyncItems({
    ctx,
    indexedIds,
    diskItemIds,
    report,
  });

  emitProgress(
    reindexQueue.length > 0 ? reindexQueue.length : total,
    reindexQueue.length > 0 ? reindexQueue.length : total,
  );
  if (reindexQueue.length === 0) {
    onBatch?.(toSyncProgress(report, total, total, phase));
  }

  if (report.errors.length === 0) {
    await ctx.index.setReconcileFingerprint(vaultId, currentFingerprint);
  }

  return report;
}
