import type { ItemFile } from "@collector/shared";
import type { SyncReport, VaultContext } from "../adapters/types.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
  INDEX_SYNC_CONTENT_YIELD_MS,
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  runWithConcurrencyYielding,
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
import { ftsFieldsFromDocumentMarkdown } from "./frontmatter.js";
import { listItemRelativePaths } from "./scan.js";
import {
  readVaultItemMetaBatch,
  readVaultItemSourceRefBatch,
  statVaultItemMetaBatch,
} from "./vault-fs-batch.js";
import { hydrateReindexQueue } from "./sync-operations/reindex-phase.js";
import {
  embeddingRefreshInputFromItem,
  flushEmbeddingRefresh,
  tagNamesForItem,
} from "./item-embedding-refresh.js";

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

  const diskStats = await statVaultItemMetaBatch(
    ctx.fs,
    vaultPath,
    uniqueItemIds,
  );
  const presentIds = new Set(diskStats.map((entry) => entry.id));
  const mtimeById = new Map(
    diskStats.map((entry) => [entry.id, entry.mtimeMs] as const),
  );

  const removedIds = uniqueItemIds.filter(
    (itemId) => !presentIds.has(itemId) && indexMeta.has(itemId),
  );

  for (
    let offset = 0;
    offset < removedIds.length;
    offset += INDEX_SYNC_WRITE_BATCH
  ) {
    const chunk = removedIds.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
    await ctx.index.deleteItemsBatch(chunk);
    report.removed += chunk.length;
    if (offset + chunk.length < removedIds.length) {
      await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    }
  }

  const existingIds = uniqueItemIds.filter((itemId) => presentIds.has(itemId));
  const metadataReadQueue: Array<{ itemId: string; diskMtimeMs: number }> = [];
  const reindexQueue: Array<{
    itemId: string;
    diskMtimeMs: number;
    item?: ItemFile;
    content?: string | null;
    hasContentFile?: boolean;
  }> = [];
  const mtimeHealFromContentIds: string[] = [];

  const resolvedMtimes = new Map<string, number>();
  const nullMtimeIds: string[] = [];
  for (const itemId of existingIds) {
    const initialMtime = mtimeById.get(itemId);
    if (initialMtime === undefined) {
      throw new Error(`Missing disk stat for ${itemId}`);
    }
    if (initialMtime === null) {
      nullMtimeIds.push(itemId);
      continue;
    }
    resolvedMtimes.set(itemId, initialMtime);
  }

  if (nullMtimeIds.length > 0) {
    const recovered = await runWithConcurrencyYielding(
      nullMtimeIds.length,
      DISK_ITEM_READ_CONCURRENCY,
      async (index) => {
        const itemId = nullMtimeIds[index]!;
        const docPath = itemMarkdownPath(vaultPath, itemId);
        try {
          return {
            itemId,
            diskMtimeMs: await recoverItemDiskMtimeMs(ctx.fs, docPath),
            error: null as string | null,
          };
        } catch (error) {
          return {
            itemId,
            diskMtimeMs: null as number | null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      { yieldEvery: INDEX_SYNC_WRITE_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
    );

    for (const entry of recovered) {
      if (entry.error !== null) {
        report.errors.push({ itemId: entry.itemId, message: entry.error });
        continue;
      }
      if (entry.diskMtimeMs === null) {
        mtimeHealFromContentIds.push(entry.itemId);
        continue;
      }
      resolvedMtimes.set(entry.itemId, entry.diskMtimeMs);
    }
  }

  for (const [itemId, diskMtimeMs] of resolvedMtimes) {
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
          ...ftsFieldsFromDocumentMarkdown(documentMarkdown),
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
        ...ftsFieldsFromDocumentMarkdown(documentMarkdown),
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

  if (reindexQueue.some((work) => !work.item)) {
    await hydrateReindexQueue(ctx, vaultPath, vaultId, tagMaps, reindexQueue);
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
