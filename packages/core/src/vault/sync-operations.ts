import type {
  IndexSyncOptions,
  IndexSyncPhase,
  SyncReport,
  VaultContext,
} from "../adapters/types.js";
import { loadReconcileSetup, tryReconcileFastPath } from "./sync-operations/reconcile.js";
import { runDiskStatsPhase } from "./sync-operations/disk-stats.js";
import { runMetadataReadPhase } from "./sync-operations/metadata-phase.js";
import {
  hydrateReindexQueue,
  runReindexMetadataPhase,
} from "./sync-operations/reindex-phase.js";
import { runContentPhase } from "./sync-operations/content-phase.js";
import { removeOrphanedIndexItems } from "./sync-operations/removal-phase.js";
import { createEmptySyncReport, toSyncProgress } from "./sync-operations/progress.js";

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

  const setup = await loadReconcileSetup(ctx, vaultPath, vaultId);

  if (await tryReconcileFastPath(ctx, vaultId, setup, report, options)) {
    return report;
  }

  emitProgress(0, setup.total);

  const diskStats = await runDiskStatsPhase(
    ctx,
    vaultPath,
    vaultId,
    setup,
    report,
  );

  const classified = await runMetadataReadPhase(
    ctx,
    vaultPath,
    vaultId,
    setup,
    report,
    diskStats.tagMaps,
    diskStats.metadataReadQueue,
    diskStats.reindexQueue,
    diskStats.classified,
  );

  const reindexQueue = diskStats.reindexQueue;
  const processedBeforeReindex = classified - reindexQueue.length;
  phase = "metadata";
  emitProgress(processedBeforeReindex, setup.total);

  await hydrateReindexQueue(
    ctx,
    vaultPath,
    vaultId,
    diskStats.tagMaps,
    reindexQueue,
  );

  await runReindexMetadataPhase(
    ctx,
    vaultId,
    report,
    reindexQueue,
    processedBeforeReindex,
    setup.total,
    emitBatch,
  );

  const metadataCompleteProgress = toSyncProgress(
    report,
    processedBeforeReindex + reindexQueue.length,
    setup.total,
    "metadata",
  );
  await onMetadataComplete?.(metadataCompleteProgress);
  if (reindexQueue.length > 0) {
    onBatch?.(metadataCompleteProgress);
  }

  phase = "content";
  await runContentPhase(
    ctx,
    vaultPath,
    vaultId,
    report,
    diskStats.tagMaps,
    reindexQueue,
    emitBatch,
  );

  await removeOrphanedIndexItems(
    ctx,
    setup.diskItemIds,
    setup.indexedIds,
    report,
  );

  emitProgress(
    reindexQueue.length > 0 ? reindexQueue.length : setup.total,
    reindexQueue.length > 0 ? reindexQueue.length : setup.total,
  );
  if (reindexQueue.length === 0) {
    onBatch?.(toSyncProgress(report, setup.total, setup.total, phase));
  }

  if (report.errors.length === 0) {
    await ctx.index.setReconcileFingerprint(vaultId, setup.currentFingerprint);
  }

  return report;
}
