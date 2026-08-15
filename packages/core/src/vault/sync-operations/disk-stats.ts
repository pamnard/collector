import type { VaultContext } from "../../adapters/types.js";
import type { SyncReport } from "../../adapters/types.js";
import { ftsFieldsFromDocumentMarkdown } from "../frontmatter.js";
import {
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  type TagMapsHolder,
} from "../item-io.js";
import {
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../../util/concurrency.js";
import { itemMarkdownPath } from "../paths.js";
import {
  diskMtimeMsFromDocumentMarkdown,
  recoverItemDiskMtimeMs,
} from "../recover-item-mtime.js";
import { readVaultItemMetaBatch, statAllVaultItemMeta } from "../vault-fs-batch.js";
import type { ReconcileSetup } from "./reconcile.js";
import type { ReindexWork } from "./types.js";

export interface DiskStatsPhaseResult {
  tagMaps: TagMapsHolder;
  stats: Array<{ itemId: string; diskMtimeMs: number }>;
  metadataReadQueue: Array<{ itemId: string; diskMtimeMs: number }>;
  reindexQueue: ReindexWork[];
  classified: number;
}

export async function runDiskStatsPhase(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  setup: ReconcileSetup,
  report: SyncReport,
): Promise<DiskStatsPhaseResult> {
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
    if (!setup.diskItemIds.has(entry.id)) {
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
    const meta = setup.indexMeta.get(stat.itemId);
    if (!meta) {
      reindexQueue.push({ itemId: stat.itemId, diskMtimeMs: stat.diskMtimeMs });
      classified += 1;
      continue;
    }

    metadataReadQueue.push({ itemId: stat.itemId, diskMtimeMs: stat.diskMtimeMs });
  }

  return {
    tagMaps,
    stats,
    metadataReadQueue,
    reindexQueue,
    classified,
  };
}
