import type { ItemFile } from "@collector/shared";
import type { SyncReport, VaultContext } from "../adapters/types.js";
import { ftsFieldsFromDocumentMarkdown } from "./frontmatter.js";
import {
  itemFileFromDocumentMarkdown,
  type TagMapsHolder,
} from "./item-io.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { readVaultItemMetaBatch } from "./vault-fs-batch.js";
import type { ReindexWork } from "./sync-operations-progress.js";

export async function reindexSyncMetadata(params: {
  ctx: VaultContext;
  vaultPath: string;
  vaultId: string;
  reindexQueue: ReindexWork[];
  tagMaps: TagMapsHolder;
  report: SyncReport;
  processedBeforeReindex: number;
  total: number;
  emitBatch: (processed: number, total: number) => void;
}): Promise<void> {
  const {
    ctx,
    vaultPath,
    vaultId,
    reindexQueue,
    tagMaps,
    report,
    processedBeforeReindex,
    total,
    emitBatch,
  } = params;

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
}
