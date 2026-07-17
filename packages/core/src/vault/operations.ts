import type { ItemFile, VaultMeta } from "@collector/shared";
import { SCHEMA_VERSION } from "@collector/shared";
import type {
  CreateVaultInput,
  IndexSyncOptions,
  IndexSyncPhase,
  IndexSyncProgress,
  SyncReport,
  UpsertItemInput,
  VaultContext,
} from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import {
  itemFileFromDocumentMarkdown,
  readItemContent,
  readItemFile,
  readItemSourceRef,
  readVaultMeta,
  writeItemDocument,
  writeItemSourceRef,
  writeVaultMeta,
} from "./item-io.js";
import { writeTagsFile } from "./tag-io.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
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
import {
  folderPathFromItemId,
  itemMarkdownPath,
  itemMediaRoot,
  normalizeRelativePath,
  vaultRoot,
  vaultsRoot,
} from "./paths.js";
import { listItemRelativePaths } from "./scan.js";
import {
  readVaultItemMetaBatch,
  statAllVaultItemMeta,
} from "./vault-fs-batch.js";

export async function createVault(
  ctx: VaultContext,
  dataDir: string,
  input: CreateVaultInput,
): Promise<{ meta: VaultMeta; path: string }> {
  const vaultId = createId();
  const timestamp = nowIso();
  const meta: VaultMeta = {
    id: vaultId,
    name: input.name,
    description: input.description ?? "",
    is_default: input.isDefault ?? false,
    schema_version: SCHEMA_VERSION,
    settings: {},
    created_at: timestamp,
    updated_at: timestamp,
  };

  const root = vaultsRoot(dataDir);
  const vaultPath = vaultRoot(root, vaultId);

  await ctx.fs.mkdir(vaultPath);
  await writeVaultMeta(ctx.fs, vaultPath, meta);
  await writeTagsFile(ctx.fs, vaultPath, { tags: [] });
  await ctx.index.upsertVault(meta, vaultPath);

  return { meta, path: vaultPath };
}

export async function upsertItem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  input: UpsertItemInput,
): Promise<ItemFile> {
  const timestamp = nowIso();
  const id = normalizeRelativePath(input.item.id);
  const item: ItemFile = {
    ...input.item,
    id,
    vault_id: vaultId,
    // Collections are real FS folders (#134): folder_path is always the
    // dirname of id, never an independent value supplied by the caller.
    folder_path: folderPathFromItemId(id),
    updated_at: timestamp,
    created_at: input.item.created_at || timestamp,
  };

  const body = input.content ?? "";
  await writeItemDocument(ctx.fs, vaultPath, item, body);

  if (input.sourceRef) {
    await writeItemSourceRef(ctx.fs, vaultPath, item.id, input.sourceRef);
  }

  const content = input.content ?? (await readItemContent(ctx.fs, vaultPath, item.id));
  const sourceRef =
    input.sourceRef ?? (await readItemSourceRef(ctx.fs, vaultPath, item.id));
  const fileStat = await ctx.fs.stat(itemMarkdownPath(vaultPath, item.id));

  await ctx.index.upsertItem(
    {
      item,
      content,
      sourceRef,
      fileMtimeMs: fileStat.mtimeMs,
    },
    vaultId,
  );
  return item;
}

export async function deleteItem(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);
  if (await ctx.fs.exists(docPath)) {
    await ctx.fs.remove(docPath);
  }
  const mediaRoot = itemMediaRoot(vaultPath, id);
  if (await ctx.fs.exists(mediaRoot)) {
    await ctx.fs.remove(mediaRoot, { recursive: true });
  }
  await ctx.fs.touch(vaultPath);
  await ctx.index.deleteItem(id);
}

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
    emitProgress(0, 0);
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
    emitProgress(total, total);
    onBatch?.(toSyncProgress(report, total, total, phase));
    return report;
  }

  emitProgress(0, total);

  const diskStats = await statAllVaultItemMeta(ctx.fs, vaultPath);
  if (diskStats.length > 0) {
    await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
  }
  const stats = diskStats
    .filter((entry) => diskItemIds.has(entry.id))
    .map((entry) => ({
      itemId: entry.id,
      diskMtimeMs: entry.mtimeMs ?? 0,
      error: null as unknown,
    }));

  const metadataReadQueue: Array<{ itemId: string; diskMtimeMs: number }> = [];
  const reindexQueue: ReindexWork[] = [];
  let classified = 0;

  for (const stat of stats) {
    if (stat.error) {
      report.errors.push({
        itemId: stat.itemId,
        message:
          stat.error instanceof Error ? stat.error.message : String(stat.error),
      });
      classified += 1;
      continue;
    }

    const meta = indexMeta.get(stat.itemId);
    if (!meta) {
      reindexQueue.push({ itemId: stat.itemId, diskMtimeMs: stat.diskMtimeMs });
      classified += 1;
      continue;
    }

    if (meta.file_mtime_ms !== null && meta.file_mtime_ms === stat.diskMtimeMs) {
      report.skipped += 1;
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
        const diskMtimeMs = metadataById.get(itemId) ?? 0;
        if (!documentMarkdown) {
          metadataReads.push({
            itemId,
            diskMtimeMs,
            item: null,
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
          );
          metadataReads.push({
            itemId,
            diskMtimeMs,
            item,
            error: null,
          });
        } catch (error) {
          metadataReads.push({
            itemId,
            diskMtimeMs,
            item: null,
            error,
          });
        }
      }
    } catch (error) {
      metadataReads = metadataIds.map((itemId) => ({
        itemId,
        diskMtimeMs: metadataById.get(itemId) ?? 0,
        item: null,
        error,
      }));
    }

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
        diskUpdatedAt: read.item.updated_at,
        diskContentRevision: read.item.content_revision,
      });

      if (action === "patch") {
        try {
          await ctx.index.patchItemSyncMeta(read.itemId, {
            fileMtimeMs: read.diskMtimeMs,
            updatedAt: read.item.updated_at,
            contentRevision: read.item.content_revision,
          });
          report.patched += 1;
          if (report.patched % INDEX_SYNC_WRITE_BATCH === 0) {
            await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
          }
        } catch (error) {
          report.errors.push({
            itemId: read.itemId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      reindexQueue.push({
        itemId: read.itemId,
        diskMtimeMs: read.diskMtimeMs,
        item: read.item,
      });
    }
  }

  // Skipped/errored/queued counts already in classified; pending work = reindexQueue.
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
      );
    }
  }

  // Phase A: metadata → list/filters queryable; FTS title/description only.
  for (let i = 0; i < reindexQueue.length; i += 1) {
    const work = reindexQueue[i]!;
    try {
      if (!work.item) {
        throw new Error(`Missing document for ${work.itemId}`);
      }
      const item = work.item;
      await ctx.index.upsertItemMetadata(
        { item, fileMtimeMs: work.diskMtimeMs },
        vaultId,
      );
      report.indexed += 1;
    } catch (error) {
      report.errors.push({
        itemId: work.itemId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const processed = processedBeforeReindex + i + 1;
    if ((i + 1) % INDEX_SYNC_WRITE_BATCH === 0 || i + 1 === reindexQueue.length) {
      emitBatch(processed, total);
      if (i + 1 < reindexQueue.length) {
        await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
      }
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

    if ((i + 1) % INDEX_SYNC_WRITE_BATCH === 0 || i + 1 === reindexQueue.length) {
      emitBatch(i + 1, reindexQueue.length);
      if (i + 1 < reindexQueue.length) {
        await yieldToEventLoop(INDEX_SYNC_CONTENT_YIELD_MS);
      }
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

export async function listItemsOnDisk(
  ctx: VaultContext,
  vaultPath: string,
): Promise<ItemFile[]> {
  if (!(await ctx.fs.exists(vaultPath))) {
    return [];
  }

  const itemIds = await listItemRelativePaths(ctx.fs, vaultPath);
  return listItemsByIds(ctx, vaultPath, itemIds);
}

export interface StreamedItemRead {
  index: number;
  itemId: string;
  item: ItemFile | null;
}

export interface StreamItemsByIdsOptions {
  concurrency?: number;
  onItem: (result: StreamedItemRead) => void;
  signal?: AbortSignal;
}

async function readItemFromDisk(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<ItemFile | null> {
  const docPath = itemMarkdownPath(vaultPath, itemId);
  if (!(await ctx.fs.exists(docPath))) {
    return null;
  }
  const meta = await readVaultMeta(ctx.fs, vaultPath);
  return readItemFile(ctx.fs, vaultPath, itemId, meta.id);
}

/** Read item documents; uses batched FS when the adapter supports it. */
export async function streamItemsByIds(
  ctx: VaultContext,
  vaultPath: string,
  itemIds: string[],
  options: StreamItemsByIdsOptions,
): Promise<void> {
  if (!itemIds.length) {
    return;
  }

  const { concurrency, onItem, signal } = options;
  const vaultMeta = await readVaultMeta(ctx.fs, vaultPath);
  const vaultId = vaultMeta.id;

  if (ctx.fs.readVaultItemsMeta) {
    const batchReads = await readVaultItemMetaBatch(ctx.fs, vaultPath, itemIds);
    const readById = new Map(
      batchReads.map((read) => [read.id, read.documentMarkdown]),
    );
    for (const [index, itemId] of itemIds.entries()) {
      if (signal?.aborted) {
        return;
      }
      const documentMarkdown = readById.get(itemId);
      let item: ItemFile | null = null;
      if (documentMarkdown) {
        try {
          const fileStat = await ctx.fs.stat(itemMarkdownPath(vaultPath, itemId));
          item = await itemFileFromDocumentMarkdown(
            ctx.fs,
            vaultPath,
            vaultId,
            itemId,
            documentMarkdown,
            fileStat.mtimeMs ?? 0,
          );
        } catch {
          item = null;
        }
      }
      onItem({ index, itemId, item });
    }
    return;
  }

  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const index = nextIndex;
      nextIndex += 1;
      if (index >= itemIds.length) {
        return;
      }

      const itemId = itemIds[index]!;
      const item = await readItemFromDisk(ctx, vaultPath, itemId);
      if (signal?.aborted) {
        return;
      }

      onItem({ index, itemId, item });
    }
  }

  const workerCount = Math.min(
    concurrency ?? DISK_ITEM_READ_CONCURRENCY,
    itemIds.length,
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export async function listItemsByIds(
  ctx: VaultContext,
  vaultPath: string,
  itemIds: string[],
): Promise<ItemFile[]> {
  const slots: Array<ItemFile | null> = new Array(itemIds.length);
  await streamItemsByIds(ctx, vaultPath, itemIds, {
    onItem: ({ index, item }) => {
      slots[index] = item;
    },
  });

  const items: ItemFile[] = [];
  for (const item of slots) {
    if (item) {
      items.push(item);
    }
  }
  return items;
}
