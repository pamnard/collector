import type { SyncReport, VaultContext } from "../adapters/types.js";
import { INDEX_SYNC_WRITE_BATCH, INDEX_SYNC_YIELD_MS, yieldToEventLoop } from "../util/concurrency.js";
import { syncIndexItemsFromFilesystem } from "./item-index-sync.js";
import { joinSegments, normalizeRelativePath } from "./paths.js";
import { listItemRelativePathsUnderPrefix } from "./scan.js";

function createEmptySyncReport(): SyncReport {
  return {
    indexed: 0,
    patched: 0,
    skipped: 0,
    contentIndexed: 0,
    removed: 0,
    errors: [],
  };
}

async function deleteIndexedItemIds(
  ctx: VaultContext,
  itemIds: string[],
  report: SyncReport,
): Promise<void> {
  for (let i = 0; i < itemIds.length; i += 1) {
    await ctx.index.deleteItem(itemIds[i]!);
    report.removed += 1;
    if ((i + 1) % INDEX_SYNC_WRITE_BATCH === 0) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }
}

/**
 * Bounded index reconcile for a folder prefix seen by the vault watcher (#567).
 * Removes orphans under the prefix; when the folder still exists, reindexes disk `.md` ids.
 */
export async function reconcileIndexFolderPrefixFromFilesystem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  folderPrefix: string,
): Promise<SyncReport> {
  const report = createEmptySyncReport();
  const normalized = normalizeRelativePath(folderPrefix);
  if (!normalized) {
    return report;
  }

  const indexedIds = await ctx.index.listItemIdsByFolderPrefix(vaultId, normalized);
  const absFolder = joinSegments(vaultPath, normalized);
  const folderExists = await ctx.fs.exists(absFolder);

  if (!folderExists) {
    await deleteIndexedItemIds(ctx, indexedIds, report);
    return report;
  }

  const diskIds = await listItemRelativePathsUnderPrefix(
    ctx.fs,
    vaultPath,
    normalized,
  );
  const diskSet = new Set(diskIds);
  await deleteIndexedItemIds(
    ctx,
    indexedIds.filter((itemId) => !diskSet.has(itemId)),
    report,
  );

  if (diskIds.length > 0) {
    const syncReport = await syncIndexItemsFromFilesystem(
      ctx,
      vaultPath,
      vaultId,
      diskIds,
    );
    report.indexed += syncReport.indexed;
    report.patched += syncReport.patched;
    report.skipped += syncReport.skipped;
    report.contentIndexed += syncReport.contentIndexed;
    report.removed += syncReport.removed;
    report.errors.push(...syncReport.errors);
  }

  return report;
}
