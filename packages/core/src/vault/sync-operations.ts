import type { IndexSyncOptions, IndexSyncPhase, SyncReport, VaultContext } from "../adapters/types.js";
import { loadTagMaps, type TagMapsHolder } from "./item-io.js";
import {
  canTakeReconcileFastPath,
  readVaultReconcileFingerprint,
} from "./reconcile-fingerprint.js";
import { listItemRelativePaths } from "./scan.js";
import { runContentPhase } from "./sync-content-phase.js";
import {
  runMetadataClassifyAndPatch,
  runMetadataReindex,
} from "./sync-metadata-phase.js";
import { prepareSyncWorkQueues } from "./sync-prepare-queues.js";
import {
  persistReconcileFingerprintIfClean,
  removeStaleIndexedItems,
} from "./sync-remove-stale.js";
import { createEmptySyncReport, toSyncProgress } from "./sync-types.js";

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

  const tagMaps: TagMapsHolder = {
    maps: await loadTagMaps(ctx.fs, vaultPath),
  };

  const { metadataReadQueue, reindexQueue, classified: preparedClassified } =
    await prepareSyncWorkQueues({
      ctx,
      vaultPath,
      vaultId,
      diskItemIds,
      indexMeta,
      tagMaps,
      report,
    });

  const classified =
    preparedClassified +
    (await runMetadataClassifyAndPatch({
      ctx,
      vaultPath,
      vaultId,
      tagMaps,
      indexMeta,
      metadataReadQueue,
      reindexQueue,
      report,
    }));

  const processedBeforeReindex = classified - reindexQueue.length;
  phase = "metadata";
  emitProgress(processedBeforeReindex, total);

  await runMetadataReindex({
    ctx,
    vaultPath,
    vaultId,
    tagMaps,
    reindexQueue,
    report,
    processedBeforeReindex,
    total,
    emitBatch,
    onMetadataComplete,
    onBatch,
  });

  phase = "content";
  await runContentPhase({
    ctx,
    vaultPath,
    vaultId,
    tagMaps,
    reindexQueue,
    report,
    emitBatch,
  });

  await removeStaleIndexedItems({
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

  await persistReconcileFingerprintIfClean({
    ctx,
    vaultId,
    currentFingerprint,
    report,
  });

  return report;
}
