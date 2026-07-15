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
  readItemContent,
  readItemFile,
  readItemSourceRef,
  writeItemContent,
  writeItemFile,
  writeItemSourceRef,
  writeVaultMeta,
} from "./item-io.js";
import { writeTagsFile } from "./tag-io.js";
import { writeFoldersFile } from "./folder-io.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  runWithConcurrencyYielding,
  yieldToEventLoop,
} from "../util/concurrency.js";
import { classifyItemSyncAction } from "./sync-classifier.js";
import {
  canTakeReconcileFastPath,
  readVaultReconcileFingerprint,
} from "./reconcile-fingerprint.js";
import {
  itemMediaRoot,
  itemMetaPath,
  itemRoot,
  itemsRoot,
  filterDiskItemIds,
  vaultRoot,
  vaultsRoot,
} from "./paths.js";

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
  await ctx.fs.mkdir(itemsRoot(vaultPath));
  await writeVaultMeta(ctx.fs, vaultPath, meta);
  await writeTagsFile(ctx.fs, vaultPath, { tags: [] });
  await writeFoldersFile(ctx.fs, vaultPath, { paths: [] });
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
  const item: ItemFile = {
    ...input.item,
    vault_id: vaultId,
    updated_at: timestamp,
    created_at: input.item.created_at || timestamp,
  };

  const itemPath = itemRoot(vaultPath, item.id);
  await ctx.fs.mkdir(itemPath);
  await ctx.fs.mkdir(itemMediaRoot(itemPath));
  await writeItemFile(ctx.fs, itemPath, item);

  if (input.content) {
    await writeItemContent(ctx.fs, itemPath, input.content);
  }

  if (input.sourceRef) {
    await writeItemSourceRef(ctx.fs, itemPath, input.sourceRef);
  }

  const content = input.content ?? (await readItemContent(ctx.fs, itemPath));
  const sourceRef = input.sourceRef ?? (await readItemSourceRef(ctx.fs, itemPath));
  const fileStat = await ctx.fs.stat(itemMetaPath(itemPath));

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
  const itemPath = itemRoot(vaultPath, itemId);
  if (await ctx.fs.exists(itemPath)) {
    await ctx.fs.remove(itemPath, { recursive: true });
  }
  await ctx.index.deleteItem(itemId);
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
  const itemsDir = itemsRoot(vaultPath);
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

  if (!(await ctx.fs.exists(itemsDir))) {
    emitProgress(0, 0);
    return report;
  }

  const diskItemIds = new Set(filterDiskItemIds(await ctx.fs.readDir(itemsDir)));
  const currentFingerprint = await readVaultReconcileFingerprint(ctx.fs, itemsDir);
  const indexedItems = await ctx.index.listVaultItemSyncMeta(vaultId);
  const storedFingerprint = await ctx.index.getReconcileFingerprint(vaultId);
  const indexMeta = new Map(indexedItems.map((item) => [item.id, item]));
  const indexedIds = new Set(indexedItems.map((item) => item.id));
  const diskIds = [...diskItemIds];
  const total = diskIds.length;

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

  const stats = await runWithConcurrencyYielding(
    diskIds.length,
    DISK_ITEM_READ_CONCURRENCY,
    async (index) => {
      const itemId = diskIds[index]!;
      const itemPath = itemRoot(vaultPath, itemId);
      try {
        const fileStat = await ctx.fs.stat(itemMetaPath(itemPath));
        return {
          itemId,
          diskMtimeMs: fileStat.mtimeMs ?? 0,
          error: null as unknown,
        };
      } catch (error) {
        return { itemId, diskMtimeMs: 0, error };
      }
    },
    { yieldEvery: INDEX_SYNC_WRITE_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
  );

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
    const metadataReads = await runWithConcurrencyYielding(
      metadataReadQueue.length,
      DISK_ITEM_READ_CONCURRENCY,
      async (index) => {
        const work = metadataReadQueue[index]!;
        const itemPath = itemRoot(vaultPath, work.itemId);
        try {
          const item = await readItemFile(ctx.fs, itemPath);
          return { ...work, item, error: null as unknown };
        } catch (error) {
          return { ...work, item: null, error };
        }
      },
      { yieldEvery: INDEX_SYNC_WRITE_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
    );

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

  // Phase A: metadata → list/filters queryable; FTS title/description only.
  for (let i = 0; i < reindexQueue.length; i += 1) {
    const work = reindexQueue[i]!;
    const itemPath = itemRoot(vaultPath, work.itemId);
    try {
      const item = work.item ?? (await readItemFile(ctx.fs, itemPath));
      await ctx.index.upsertItemMetadata(
        { item, fileMtimeMs: work.diskMtimeMs },
        vaultId,
      );
      work.item = item;
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
    const itemPath = itemRoot(vaultPath, work.itemId);
    try {
      const content = await readItemContent(ctx.fs, itemPath);
      const sourceRef = await readItemSourceRef(ctx.fs, itemPath);
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
        await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
      }
    }
  }

  for (const indexedId of indexedIds) {
    if (!diskItemIds.has(indexedId)) {
      await ctx.index.deleteItem(indexedId);
      report.removed += 1;
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
  const itemsDir = itemsRoot(vaultPath);
  if (!(await ctx.fs.exists(itemsDir))) {
    return [];
  }

  const itemIds = await ctx.fs.readDir(itemsDir);
  const items: ItemFile[] = [];

  for (const itemId of itemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    items.push(await readItemFile(ctx.fs, itemPath));
  }

  return items;
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
  const itemPath = itemRoot(vaultPath, itemId);
  if (!(await ctx.fs.exists(itemPath))) {
    return null;
  }
  return readItemFile(ctx.fs, itemPath);
}

/** Read item.json files in parallel; invokes onItem as each read finishes. */
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
