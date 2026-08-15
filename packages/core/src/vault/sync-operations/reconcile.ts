import type { VaultContext } from "../../adapters/types.js";
import {
  canTakeReconcileFastPath,
  readVaultReconcileFingerprint,
  type ReconcileFingerprint,
} from "../reconcile-fingerprint.js";
import { listItemRelativePaths } from "../scan.js";
import { toSyncProgress } from "./progress.js";
import type { SyncReport } from "../../adapters/types.js";
import type { IndexSyncOptions } from "../../adapters/types.js";

export interface ReconcileSetup {
  diskItemIds: Set<string>;
  indexedIds: Set<string>;
  indexMeta: Map<
    string,
    Awaited<ReturnType<VaultContext["index"]["listVaultItemSyncMeta"]>>[number]
  >;
  total: number;
  currentFingerprint: ReconcileFingerprint;
}

export async function loadReconcileSetup(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<ReconcileSetup> {
  const diskItemIds = new Set(await listItemRelativePaths(ctx.fs, vaultPath));
  const currentFingerprint = await readVaultReconcileFingerprint(
    ctx.fs,
    vaultPath,
    diskItemIds.size,
  );
  const indexedItems = await ctx.index.listVaultItemSyncMeta(vaultId);
  const indexMeta = new Map(indexedItems.map((item) => [item.id, item]));
  const indexedIds = new Set(indexedItems.map((item) => item.id));
  return {
    diskItemIds,
    indexedIds,
    indexMeta,
    total: diskItemIds.size,
    currentFingerprint,
  };
}

export async function tryReconcileFastPath(
  ctx: VaultContext,
  vaultId: string,
  setup: ReconcileSetup,
  report: SyncReport,
  options: IndexSyncOptions,
): Promise<boolean> {
  const { onProgress, onBatch, onMetadataComplete } = options;
  const storedFingerprint = await ctx.index.getReconcileFingerprint(vaultId);
  const indexedItemCount = setup.indexMeta.size;

  if (
    !canTakeReconcileFastPath({
      storedFingerprint,
      currentFingerprint: setup.currentFingerprint,
      indexedItemCount,
      diskItemCount: setup.diskItemIds.size,
      indexedIds: setup.indexedIds,
      diskItemIds: setup.diskItemIds,
    })
  ) {
    return false;
  }

  report.skipped = setup.total;
  const fastPathProgress = toSyncProgress(report, setup.total, setup.total, "metadata");
  onProgress?.(fastPathProgress);
  await onMetadataComplete?.(fastPathProgress);
  onBatch?.(fastPathProgress);
  return true;
}
