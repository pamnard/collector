import type { VaultContext } from "../../adapters/types.js";
import type { SyncReport } from "../../adapters/types.js";
import { ftsFieldsFromDocumentMarkdown } from "../frontmatter.js";
import { itemFileFromDocumentMarkdown, type TagMapsHolder } from "../item-io.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  runWithConcurrencyYielding,
  yieldToEventLoop,
} from "../../util/concurrency.js";
import { readVaultItemMetaBatch } from "../vault-fs-batch.js";
import type { ReindexWork } from "./types.js";

export async function hydrateReindexQueue(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  tagMaps: TagMapsHolder,
  reindexQueue: ReindexWork[],
): Promise<void> {
  const needingRead = reindexQueue.filter((work) => !work.item);
  if (needingRead.length === 0) {
    return;
  }

  const reindexReads = await readVaultItemMetaBatch(
    ctx.fs,
    vaultPath,
    needingRead.map((work) => work.itemId),
  );
  const reindexMdById = new Map(
    reindexReads.map((read) => [read.id, read.documentMarkdown]),
  );

  const pending: Array<{ work: ReindexWork; documentMarkdown: string }> = [];
  for (const work of needingRead) {
    const documentMarkdown = reindexMdById.get(work.itemId);
    if (!documentMarkdown) {
      continue;
    }
    pending.push({ work, documentMarkdown });
  }
  if (pending.length === 0) {
    return;
  }

  await runWithConcurrencyYielding(
    pending.length,
    DISK_ITEM_READ_CONCURRENCY,
    async (index) => {
      const { work, documentMarkdown } = pending[index]!;
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
    },
    { yieldEvery: INDEX_SYNC_WRITE_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
  );
}

export async function runReindexMetadataPhase(
  ctx: VaultContext,
  vaultId: string,
  report: SyncReport,
  reindexQueue: ReindexWork[],
  processedBeforeReindex: number,
  total: number,
  emitBatch: (processed: number, total: number) => void,
): Promise<void> {
  for (let offset = 0; offset < reindexQueue.length; offset += INDEX_SYNC_WRITE_BATCH) {
    const workBatch = reindexQueue.slice(
      offset,
      offset + INDEX_SYNC_WRITE_BATCH,
    );
    const records: Array<{ item: import("@collector/shared").ItemFile; fileMtimeMs: number }> = [];
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
