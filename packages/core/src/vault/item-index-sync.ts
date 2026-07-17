import type { ItemFile } from "@collector/shared";
import type { SyncReport, VaultContext } from "../adapters/types.js";
import {
  INDEX_SYNC_CONTENT_YIELD_MS,
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { classifyItemSyncAction } from "./sync-classifier.js";
import { readVaultReconcileFingerprint } from "./reconcile-fingerprint.js";
import {
  itemMetaPath,
  itemRoot,
  itemsRoot,
} from "./paths.js";
import {
  itemFileFromDocumentMarkdown,
  readItemContent,
  readItemSourceRef,
} from "./item-io.js";
import { readVaultItemMetaBatch } from "./vault-fs-batch.js";

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

/** Targeted index reconcile for explicit item ids (filesystem watcher path). */
export async function syncIndexItemsFromFilesystem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemIds: string[],
): Promise<SyncReport> {
  const report = createEmptySyncReport();
  if (itemIds.length === 0) {
    return report;
  }

  const uniqueItemIds = [...new Set(itemIds)];
  const indexedItems = await ctx.index.listVaultItemSyncMeta(vaultId);
  const indexMeta = new Map(indexedItems.map((item) => [item.id, item]));

  const existingIds: string[] = [];
  const removedIds: string[] = [];

  for (const itemId of uniqueItemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    if (await ctx.fs.exists(itemPath)) {
      existingIds.push(itemId);
    } else if (indexMeta.has(itemId)) {
      removedIds.push(itemId);
    }
  }

  for (let i = 0; i < removedIds.length; i += 1) {
    const itemId = removedIds[i]!;
    await ctx.index.deleteItem(itemId);
    report.removed += 1;
    if ((i + 1) % INDEX_SYNC_WRITE_BATCH === 0) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }

  const metadataReadQueue: Array<{ itemId: string; diskMtimeMs: number }> = [];
  const reindexQueue: Array<{
    itemId: string;
    diskMtimeMs: number;
    item?: ItemFile;
  }> = [];

  for (const itemId of existingIds) {
    const metaPath = itemMetaPath(itemRoot(vaultPath, itemId));
    const fileStat = await ctx.fs.stat(metaPath);
    const diskMtimeMs = fileStat.mtimeMs ?? 0;
    const meta = indexMeta.get(itemId);

    if (!meta) {
      reindexQueue.push({ itemId, diskMtimeMs });
      continue;
    }

    if (meta.file_mtime_ms !== null && meta.file_mtime_ms === diskMtimeMs) {
      report.skipped += 1;
      continue;
    }

    metadataReadQueue.push({ itemId, diskMtimeMs });
  }

  if (metadataReadQueue.length > 0) {
    const metadataIds = metadataReadQueue.map((work) => work.itemId);
    const metadataById = new Map(
      metadataReadQueue.map((work) => [work.itemId, work.diskMtimeMs]),
    );
    const batchReads = await readVaultItemMetaBatch(ctx.fs, vaultPath, metadataIds);
    const readById = new Map(
      batchReads.map((read) => [read.id, read.documentMarkdown]),
    );

    for (const itemId of metadataIds) {
      const diskMtimeMs = metadataById.get(itemId) ?? 0;
      const documentMarkdown = readById.get(itemId);
      if (!documentMarkdown) {
        report.errors.push({
          itemId,
          message: `Missing content.md for ${itemId}`,
        });
        continue;
      }

      let item: ItemFile;
      try {
        item = await itemFileFromDocumentMarkdown(
          ctx.fs,
          vaultPath,
          vaultId,
          itemId,
          documentMarkdown,
          diskMtimeMs,
        );
      } catch (error) {
        report.errors.push({
          itemId,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const meta = indexMeta.get(itemId);
      const action = classifyItemSyncAction({
        indexed: !!meta,
        dbMtimeMs: meta?.file_mtime_ms ?? null,
        diskMtimeMs,
        dbUpdatedAt: meta?.updated_at,
        dbContentRevision: meta?.content_revision,
        diskUpdatedAt: item.updated_at,
        diskContentRevision: item.content_revision,
      });

      if (action === "skip") {
        report.skipped += 1;
        continue;
      }

      if (action === "patch") {
        try {
          await ctx.index.patchItemSyncMeta(itemId, {
            fileMtimeMs: diskMtimeMs,
            updatedAt: item.updated_at,
            contentRevision: item.content_revision,
          });
          report.patched += 1;
        } catch (error) {
          report.errors.push({
            itemId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      reindexQueue.push({ itemId, diskMtimeMs, item });
    }
  }

  const reindexIdsNeedingRead = reindexQueue
    .filter((work) => !work.item)
    .map((work) => work.itemId);
  if (reindexIdsNeedingRead.length > 0) {
    const reindexReads = await readVaultItemMetaBatch(
      ctx.fs,
      vaultPath,
      reindexIdsNeedingRead,
    );
    const reindexMdById = new Map(
      reindexReads.map((read) => [read.id, read.documentMarkdown]),
    );
    for (const work of reindexQueue) {
      if (work.item) {
        continue;
      }
      const documentMarkdown = reindexMdById.get(work.itemId);
      if (!documentMarkdown) {
        continue;
      }
      work.item = await itemFileFromDocumentMarkdown(
        ctx.fs,
        vaultPath,
        vaultId,
        work.itemId,
        documentMarkdown,
        work.diskMtimeMs,
      );
    }
  }

  for (let i = 0; i < reindexQueue.length; i += 1) {
    const work = reindexQueue[i]!;
    try {
      if (!work.item) {
        throw new Error(`Missing content.md for ${work.itemId}`);
      }
      await ctx.index.upsertItemMetadata(
        { item: work.item, fileMtimeMs: work.diskMtimeMs },
        vaultId,
      );
      report.indexed += 1;
    } catch (error) {
      report.errors.push({
        itemId: work.itemId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if ((i + 1) % INDEX_SYNC_WRITE_BATCH === 0) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }

  for (let i = 0; i < reindexQueue.length; i += 1) {
    const work = reindexQueue[i]!;
    if (!work.item) {
      continue;
    }
    const itemPath = itemRoot(vaultPath, work.itemId);
    try {
      const content = await readItemContent(ctx.fs, itemPath, vaultId);
      const sourceRef = await readItemSourceRef(ctx.fs, itemPath);
      await ctx.index.upsertItemContent({
        itemId: work.item.id,
        title: work.item.title,
        description: work.item.description,
        content,
        sourceRef,
      });
      report.contentIndexed += 1;
    } catch (error) {
      report.errors.push({
        itemId: work.itemId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if ((i + 1) % INDEX_SYNC_WRITE_BATCH === 0) {
      await yieldToEventLoop(INDEX_SYNC_CONTENT_YIELD_MS);
    }
  }

  if (report.errors.length === 0) {
    const itemsDir = itemsRoot(vaultPath);
    const currentFingerprint = await readVaultReconcileFingerprint(ctx.fs, itemsDir);
    await ctx.index.setReconcileFingerprint(vaultId, currentFingerprint);
  }

  return report;
}
