import type { ItemFile } from "@collector/shared";
import type {
  IndexSyncOptions,
  IndexSyncPhase,
  IndexSyncProgress,
  SyncReport,
  VaultContext,
} from "../adapters/types.js";
import { ftsFieldsFromDocumentMarkdown } from "./frontmatter.js";
import {
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  type TagMapsHolder,
} from "./item-io.js";
import {
  INDEX_SYNC_CONTENT_YIELD_MS,
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { classifyItemSyncAction } from "./sync-classifier.js";
import {
  canTakeReconcileFastPath,
  readVaultReconcileFingerprint,
} from "./reconcile-fingerprint.js";
import { itemMarkdownPath } from "./paths.js";
import { listItemRelativePaths } from "./scan.js";
import {
  diskMtimeMsFromDocumentMarkdown,
  recoverItemDiskMtimeMs,
} from "./recover-item-mtime.js";
import {
  readVaultItemMetaBatch,
  readVaultItemSourceRefBatch,
  statAllVaultItemMeta,
} from "./vault-fs-batch.js";
import {
  embeddingRefreshInputFromItem,
  flushEmbeddingRefresh,
  tagNamesForItem,
} from "./item-embedding-refresh.js";

function createEmptySyncReport(): SyncReport {
  return {
    skipped: 0,
    patched: 0,
    indexed: 0,
    contentIndexed: 0,
    removed: 0,
    errors: [],
  };
}

interface ReindexWork {
  itemId: string;
  diskMtimeMs: number;
  item?: ItemFile;
  content?: string | null;
  hasContentFile?: boolean;
}

function toSyncProgress(
  report: SyncReport,
  processed: number,
  total: number,
  phase: IndexSyncPhase = "metadata",
): IndexSyncProgress {
  return {
    phase,
    processed,
    total,
    skipped: report.skipped,
    patched: report.patched,
    indexed: report.indexed,
    contentIndexed: report.contentIndexed,
    removed: report.removed,
  };
}

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

  const diskStats = await statAllVaultItemMeta(ctx.fs, vaultPath);
  if (diskStats.length > 0) {
    await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
  }
  const stats: Array<{ itemId: string; diskMtimeMs: number }> = [];
  const mtimeHealFromContentIds: string[] = [];
  for (const entry of diskStats) {
    if (!diskItemIds.has(entry.id)) {
      continue;
    }
    let diskMtimeMs = entry.mtimeMs;
    if (diskMtimeMs === null) {
      const docPath = itemMarkdownPath(vaultPath, entry.id);
      try {
        diskMtimeMs = await recoverItemDiskMtimeMs(ctx.fs, docPath);
      } catch (error) {
        report.errors.push({
          itemId: entry.id,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    if (diskMtimeMs === null) {
      mtimeHealFromContentIds.push(entry.id);
      continue;
    }
    stats.push({ itemId: entry.id, diskMtimeMs });
  }

  const metadataReadQueue: Array<{ itemId: string; diskMtimeMs: number }> = [];
  const reindexQueue: ReindexWork[] = [];
  let classified = 0;

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
        classified += 1;
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
          ...ftsFieldsFromDocumentMarkdown(documentMarkdown),
        });
      } catch (error) {
        report.errors.push({
          itemId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      classified += 1;
    }
  }

  for (const stat of stats) {
    const meta = indexMeta.get(stat.itemId);
    if (!meta) {
      reindexQueue.push({ itemId: stat.itemId, diskMtimeMs: stat.diskMtimeMs });
      classified += 1;
      continue;
    }

    metadataReadQueue.push({ itemId: stat.itemId, diskMtimeMs: stat.diskMtimeMs });
  }

  if (metadataReadQueue.length > 0) {
    const metadataIds = metadataReadQueue.map((work) => work.itemId);
    const metadataById = new Map(
      metadataReadQueue.map((work) => [work.itemId, work.diskMtimeMs]),
    );

    let metadataReads: Array<{
      itemId: string;
      diskMtimeMs: number;
      item: ItemFile | null;
      content: string | null;
      hasContentFile: boolean | null;
      error: unknown;
    }>;

    try {
      const batchReads = await readVaultItemMetaBatch(
        ctx.fs,
        vaultPath,
        metadataIds,
      );
      const readById = new Map(
        batchReads.map((read) => [read.id, read.documentMarkdown]),
      );
      metadataReads = [];
      for (const itemId of metadataIds) {
        const documentMarkdown = readById.get(itemId);
        const diskMtimeMs = metadataById.get(itemId);
        if (diskMtimeMs === undefined) {
          throw new Error(`Missing disk mtime for ${itemId}`);
        }
        if (!documentMarkdown) {
          metadataReads.push({
            itemId,
            diskMtimeMs,
            item: null,
            content: null,
            hasContentFile: null,
            error: new Error(`Missing document for ${itemId}`),
          });
          continue;
        }
        try {
          const item = await itemFileFromDocumentMarkdown(
            ctx.fs,
            vaultPath,
            vaultId,
            itemId,
            documentMarkdown,
            diskMtimeMs,
            tagMaps,
          );
          const fts = ftsFieldsFromDocumentMarkdown(documentMarkdown);
          metadataReads.push({
            itemId,
            diskMtimeMs,
            item,
            content: fts.content,
            hasContentFile: fts.hasContentFile,
            error: null,
          });
        } catch (error) {
          metadataReads.push({
            itemId,
            diskMtimeMs,
            item: null,
            content: null,
            hasContentFile: null,
            error,
          });
        }
      }
    } catch (error) {
      metadataReads = metadataIds.map((itemId) => {
        const diskMtimeMs = metadataById.get(itemId);
        if (diskMtimeMs === undefined) {
          throw new Error(`Missing disk mtime for ${itemId}`);
        }
        return {
          itemId,
          diskMtimeMs,
          item: null,
          content: null,
          hasContentFile: null,
          error,
        };
      });
    }

    const syncMetaPatches: Array<{
      itemId: string;
      fileMtimeMs: number;
      updatedAt: string;
      contentRevision: number;
      createdAt: string;
    }> = [];

    for (const read of metadataReads) {
      classified += 1;
      if (read.error || !read.item) {
        report.errors.push({
          itemId: read.itemId,
          message:
            read.error instanceof Error ? read.error.message : String(read.error),
        });
        continue;
      }

      const meta = indexMeta.get(read.itemId);
      const action = classifyItemSyncAction({
        indexed: !!meta,
        dbMtimeMs: meta?.file_mtime_ms ?? null,
        diskMtimeMs: read.diskMtimeMs,
        dbUpdatedAt: meta?.updated_at,
        dbContentRevision: meta?.content_revision,
        dbCreatedAt: meta?.created_at,
        diskUpdatedAt: read.item.updated_at,
        diskContentRevision: read.item.content_revision,
        diskCreatedAt: read.item.created_at,
      });

      if (action === "skip") {
        report.skipped += 1;
        continue;
      }

      if (action === "patch") {
        syncMetaPatches.push({
          itemId: read.itemId,
          fileMtimeMs: read.diskMtimeMs,
          updatedAt: read.item.updated_at,
          contentRevision: read.item.content_revision,
          createdAt: read.item.created_at,
        });
        continue;
      }

      reindexQueue.push({
        itemId: read.itemId,
        diskMtimeMs: read.diskMtimeMs,
        item: read.item,
        content: read.content,
        hasContentFile: read.hasContentFile ?? undefined,
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

  const processedBeforeReindex = classified - reindexQueue.length;
  phase = "metadata";
  emitProgress(processedBeforeReindex, total);

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
      const fts = ftsFieldsFromDocumentMarkdown(documentMarkdown);
      work.content = fts.content;
      work.hasContentFile = fts.hasContentFile;
    }
  }

  for (let offset = 0; offset < reindexQueue.length; offset += INDEX_SYNC_WRITE_BATCH) {
    const workBatch = reindexQueue.slice(
      offset,
      offset + INDEX_SYNC_WRITE_BATCH,
    );
    const records: Array<{ item: ItemFile; fileMtimeMs: number }> = [];
    const workByRecord: ReindexWork[] = [];
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

    const processed = processedBeforeReindex + offset + workBatch.length;
    emitBatch(processed, total);
    if (offset + workBatch.length < reindexQueue.length) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }

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

  // Phase B: content + source_ref + FTS body (same queue; reuse item from Phase A).
  phase = "content";
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
    const embeddingInputs = [];
    for (const work of workBatch) {
      if (!work.item) {
        continue;
      }
      try {
        if (work.content === undefined) {
          throw new Error(`Missing content for ${work.itemId}`);
        }
        if (work.hasContentFile === undefined) {
          throw new Error(`Missing hasContentFile for ${work.itemId}`);
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
          hasContentFile: work.hasContentFile,
          sourceRef,
        });
        if (ctx.embeddings || ctx.embeddingRefreshJobs) {
          embeddingInputs.push(
            embeddingRefreshInputFromItem(
              work.item,
              tagNamesForItem(work.item, tagMaps.maps.byId),
              work.content,
            ),
          );
        }
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
      if (embeddingInputs.length > 0) {
        await flushEmbeddingRefresh(ctx, vaultId, embeddingInputs);
      }
    } catch (error) {
      for (const input of inputs) {
        report.errors.push({
          itemId: input.itemId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    emitBatch(offset + workBatch.length, reindexQueue.length);
    if (offset + workBatch.length < reindexQueue.length) {
      await yieldToEventLoop(INDEX_SYNC_CONTENT_YIELD_MS);
    }
  }

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
