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
import { itemMarkdownPath } from "./paths.js";
import {
  diskMtimeMsFromDocumentMarkdown,
  recoverItemDiskMtimeMs,
} from "./recover-item-mtime.js";
import {
  itemFileFromDocumentMarkdown,
  readItemContent,
  readItemSourceRef,
} from "./item-io.js";
import { listItemRelativePaths } from "./scan.js";
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
  const indexedItems = await ctx.index.listItemSyncMetaByIds(
    vaultId,
    uniqueItemIds,
  );
  const indexMeta = new Map(indexedItems.map((item) => [item.id, item]));

  const existingIds: string[] = [];
  const removedIds: string[] = [];

  for (const itemId of uniqueItemIds) {
    const docPath = itemMarkdownPath(vaultPath, itemId);
    if (await ctx.fs.exists(docPath)) {
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
  const mtimeHealFromContentIds: string[] = [];

  for (const itemId of existingIds) {
    const docPath = itemMarkdownPath(vaultPath, itemId);
    let diskMtimeMs: number | null;
    try {
      diskMtimeMs = await recoverItemDiskMtimeMs(ctx.fs, docPath);
    } catch (error) {
      report.errors.push({
        itemId,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (diskMtimeMs === null) {
      mtimeHealFromContentIds.push(itemId);
      continue;
    }

    const meta = indexMeta.get(itemId);

    if (!meta) {
      reindexQueue.push({ itemId, diskMtimeMs });
      continue;
    }

    metadataReadQueue.push({ itemId, diskMtimeMs });
  }

  if (mtimeHealFromContentIds.length > 0) {
    const healReads = await readVaultItemMetaBatch(
      ctx.fs,
      vaultPath,
      mtimeHealFromContentIds,
    );
    const healMdById = new Map(
      healReads.map((read) => [read.id, read.documentMarkdown]),
    );
    for (const itemId of mtimeHealFromContentIds) {
      const documentMarkdown = healMdById.get(itemId);
      if (!documentMarkdown) {
        report.errors.push({
          itemId,
          message: `Missing document for ${itemId}`,
        });
        continue;
      }
      try {
        const diskMtimeMs = diskMtimeMsFromDocumentMarkdown(documentMarkdown);
        const item = await itemFileFromDocumentMarkdown(
          ctx.fs,
          vaultPath,
          vaultId,
          itemId,
          documentMarkdown,
          diskMtimeMs,
        );
        reindexQueue.push({ itemId, diskMtimeMs, item });
      } catch (error) {
        report.errors.push({
          itemId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
      const diskMtimeMs = metadataById.get(itemId);
      if (diskMtimeMs === undefined) {
        throw new Error(`Missing disk mtime for ${itemId}`);
      }
      const documentMarkdown = readById.get(itemId);
      if (!documentMarkdown) {
        report.errors.push({
          itemId,
          message: `Missing document for ${itemId}`,
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
        dbCreatedAt: meta?.created_at,
        diskUpdatedAt: item.updated_at,
        diskContentRevision: item.content_revision,
        diskCreatedAt: item.created_at,
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
            createdAt: item.created_at,
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
        throw new Error(`Missing document for ${work.itemId}`);
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
    try {
      const content = await readItemContent(ctx.fs, vaultPath, work.itemId);
      const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, work.itemId);
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
    const itemCount = (await listItemRelativePaths(ctx.fs, vaultPath)).length;
    const currentFingerprint = await readVaultReconcileFingerprint(
      ctx.fs,
      vaultPath,
      itemCount,
    );
    await ctx.index.setReconcileFingerprint(vaultId, currentFingerprint);
  }

  return report;
}
