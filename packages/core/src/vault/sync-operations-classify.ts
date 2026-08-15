import type { ItemFile } from "@collector/shared";
import type {
  ItemSyncMeta,
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
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { classifyItemSyncAction } from "./sync-classifier.js";
import { itemMarkdownPath } from "./paths.js";
import {
  diskMtimeMsFromDocumentMarkdown,
  recoverItemDiskMtimeMs,
} from "./recover-item-mtime.js";
import {
  readVaultItemMetaBatch,
  statAllVaultItemMeta,
} from "./vault-fs-batch.js";
import type { ReindexWork } from "./sync-operations-progress.js";

export interface ClassifyAndPatchSyncItemsResult {
  reindexQueue: ReindexWork[];
  classified: number;
  tagMaps: TagMapsHolder;
}

export async function classifyAndPatchSyncItems(params: {
  ctx: VaultContext;
  vaultPath: string;
  vaultId: string;
  diskItemIds: Set<string>;
  indexMeta: Map<string, ItemSyncMeta>;
  report: SyncReport;
}): Promise<ClassifyAndPatchSyncItemsResult> {
  const { ctx, vaultPath, vaultId, diskItemIds, indexMeta, report } = params;

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

  return { reindexQueue, classified, tagMaps };
}
