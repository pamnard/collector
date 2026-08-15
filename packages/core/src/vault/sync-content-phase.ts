import type { SyncReport, VaultContext } from "../adapters/types.js";
import {
  INDEX_SYNC_CONTENT_YIELD_MS,
  INDEX_SYNC_WRITE_BATCH,
  yieldToEventLoop,
} from "../util/concurrency.js";
import {
  embeddingRefreshInputFromItem,
  flushEmbeddingRefresh,
  tagNamesForItem,
} from "./item-embedding-refresh.js";
import type { TagMapsHolder } from "./item-io.js";
import type { ReindexWork, SyncEmit } from "./sync-types.js";
import { readVaultItemSourceRefBatch } from "./vault-fs-batch.js";

export async function runContentPhase(args: {
  ctx: VaultContext;
  vaultPath: string;
  vaultId: string;
  tagMaps: TagMapsHolder;
  reindexQueue: ReindexWork[];
  report: SyncReport;
  emitBatch: SyncEmit;
}): Promise<void> {
  const { ctx, vaultPath, vaultId, tagMaps, reindexQueue, report, emitBatch } =
    args;

  const sourceRefs = await readVaultItemSourceRefBatch(
    ctx.fs,
    vaultPath,
    reindexQueue.filter((work) => work.item).map((work) => work.itemId),
  );
  for (
    let offset = 0;
    offset < reindexQueue.length;
    offset += INDEX_SYNC_WRITE_BATCH
  ) {
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
}
