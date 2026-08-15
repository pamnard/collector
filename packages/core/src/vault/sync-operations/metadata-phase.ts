import type { ItemFile } from "@collector/shared";
import type { VaultContext } from "../../adapters/types.js";
import type { SyncReport } from "../../adapters/types.js";
import { ftsFieldsFromDocumentMarkdown } from "../frontmatter.js";
import { itemFileFromDocumentMarkdown, type TagMapsHolder } from "../item-io.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../../util/concurrency.js";
import { classifyItemSyncAction } from "../sync-classifier.js";
import { readVaultItemMetaBatch } from "../vault-fs-batch.js";
import type { ReconcileSetup } from "./reconcile.js";
import type { ReindexWork } from "./types.js";

export async function runMetadataReadPhase(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  setup: ReconcileSetup,
  report: SyncReport,
  tagMaps: TagMapsHolder,
  metadataReadQueue: Array<{ itemId: string; diskMtimeMs: number }>,
  reindexQueue: ReindexWork[],
  classifiedStart: number,
): Promise<number> {
  let classified = classifiedStart;

  if (metadataReadQueue.length === 0) {
    return classified;
  }

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

    const meta = setup.indexMeta.get(read.itemId);
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

  return classified;
}
