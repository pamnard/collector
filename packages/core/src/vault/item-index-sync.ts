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
  loadTagMaps,
  type TagMapsHolder,
} from "./item-io.js";
import { parseDocumentMarkdown } from "./frontmatter.js";
import { listItemRelativePaths } from "./scan.js";
import {
  readVaultItemMetaBatch,
  readVaultItemSourceRefBatch,
} from "./vault-fs-batch.js";

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
  const tagMaps: TagMapsHolder = {
    maps: await loadTagMaps(ctx.fs, vaultPath),
  };

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
    content?: string | null;
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
          tagMaps,
        );
        reindexQueue.push({
          itemId,
          diskMtimeMs,
          item,
          content: parseDocumentMarkdown(documentMarkdown).body,
        });
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

    const syncMetaPatches: Array<{
      itemId: string;
      fileMtimeMs: number;
      updatedAt: string;
      contentRevision: number;
      createdAt: string;
    }> = [];

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
          tagMaps,
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
        syncMetaPatches.push({
          itemId,
          fileMtimeMs: diskMtimeMs,
          updatedAt: item.updated_at,
          contentRevision: item.content_revision,
          createdAt: item.created_at,
        });
        continue;
      }

      reindexQueue.push({
        itemId,
        diskMtimeMs,
        item,
        content: parseDocumentMarkdown(documentMarkdown).body,
      });
    }

    for (
      let offset = 0;
      offset < syncMetaPatches.length;
      offset += INDEX_SYNC_WRITE_BATCH
    ) {
      const patches = syncMetaPatches.slice(
        offset,
        offset + INDEX_SYNC_WRITE_BATCH,
      );
      try {
        await ctx.index.patchItemSyncMetaBatch(patches);
        report.patched += patches.length;
      } catch (error) {
        for (const patch of patches) {
          report.errors.push({
            itemId: patch.itemId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
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
        tagMaps,
      );
      work.content = parseDocumentMarkdown(documentMarkdown).body;
    }
  }

  for (let offset = 0; offset < reindexQueue.length; offset += INDEX_SYNC_WRITE_BATCH) {
    const workBatch = reindexQueue.slice(
      offset,
      offset + INDEX_SYNC_WRITE_BATCH,
    );
    const records: Array<{ item: ItemFile; fileMtimeMs: number }> = [];
    const workByRecord: typeof reindexQueue = [];
    for (const work of workBatch) {
      if (!work.item) {
        report.errors.push({
          itemId: work.itemId,
          message: `Missing document for ${work.itemId}`,
        });
        continue;
      }
      records.push({ item: work.item, fileMtimeMs: work.diskMtimeMs });
      workByRecord.push(work);
    }

    try {
      if (records.length > 0) {
        await ctx.index.upsertItemMetadataBatch(records, vaultId);
        report.indexed += records.length;
      }
    } catch (error) {
      for (const work of workByRecord) {
        report.errors.push({
          itemId: work.itemId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (offset + workBatch.length < reindexQueue.length) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }

  const sourceRefs = await readVaultItemSourceRefBatch(
    ctx.fs,
    vaultPath,
    reindexQueue.filter((work) => work.item).map((work) => work.itemId),
  );
  for (let offset = 0; offset < reindexQueue.length; offset += INDEX_SYNC_WRITE_BATCH) {
    const workBatch = reindexQueue.slice(
      offset,
      offset + INDEX_SYNC_WRITE_BATCH,
    );
    const inputs = [];
    for (const work of workBatch) {
      if (!work.item) {
        continue;
      }
      try {
        if (work.content === undefined) {
          throw new Error(`Missing content for ${work.itemId}`);
        }
        const sourceRef = sourceRefs.get(work.itemId);
        if (sourceRef === undefined) {
          throw new Error(`Missing source reference for ${work.itemId}`);
        }
        inputs.push({
          itemId: work.item.id,
          title: work.item.title,
          description: work.item.description,
          content: work.content,
          sourceRef,
        });
      } catch (error) {
        report.errors.push({
          itemId: work.itemId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      if (inputs.length > 0) {
        await ctx.index.upsertItemContentBatch(inputs);
        report.contentIndexed += inputs.length;
      }
    } catch (error) {
      for (const input of inputs) {
        report.errors.push({
          itemId: input.itemId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (offset + workBatch.length < reindexQueue.length) {
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
