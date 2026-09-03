import type { ItemFile } from "@collector/shared";
import type { UpsertItemInput, VaultContext } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import {
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  readItemFile,
  readVaultMeta,
  writeItemDocument,
  writeItemSourceRef,
  type TagMapsHolder,
} from "./item-io.js";
import { syncTagsToIndex } from "./tag-operations.js";
import { DISK_ITEM_READ_CONCURRENCY } from "../util/concurrency.js";
import {
  folderPathFromItemId,
  itemMarkdownPath,
  noteSharedMediaRoot,
  noteUuidFromItemPath,
  normalizeRelativePath,
} from "./paths.js";
import { listItemRelativePaths } from "./scan.js";
import {
  diskMtimeMsFromDocumentMarkdown,
  ensureFileMtimeAdvanced,
} from "./recover-item-mtime.js";
import { readVaultItemMetaBatch } from "./vault-fs-batch.js";
import {
  refreshItemIndexAfterWrite,
  pruneReleasedTagsAfterIndexRefresh,
} from "./item-index-refresh.js";
import { countTextStats } from "./text-stats.js";

/**
 * Sync this item's tag catalog rows + item_tags so full tag reconcile cannot
 * drop freshly ensured names before derived refresh finishes.
 *
 * When `preserveIndexSnapshot` is set and the item already has an index row,
 * keep the indexed content_revision / file_mtime_ms (deferIndexRefresh /
 * localize owns the snapshot bump). Tag ids still update.
 */
async function pinItemTagsToIndex(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  fileMtimeMs: number,
  options?: { preserveIndexSnapshot?: boolean },
): Promise<void> {
  await syncTagsToIndex(ctx, vaultPath, vaultId, { tagIds: item.tag_ids });
  const [existing] = await ctx.index.listItemFilesByIds(vaultId, [item.id]);
  const preserve =
    options?.preserveIndexSnapshot === true && existing !== undefined;
  let fileMtimeForMeta = fileMtimeMs;
  if (preserve) {
    const [syncMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [
      item.id,
    ]);
    if (syncMeta?.file_mtime_ms != null) {
      fileMtimeForMeta = syncMeta.file_mtime_ms;
    }
  }
  const pinned: ItemFile = {
    ...item,
    collection_ids: existing?.collection_ids ?? item.collection_ids,
    ...(preserve
      ? {
          content_revision: existing.content_revision,
          updated_at: existing.updated_at,
        }
      : {}),
  };
  await ctx.index.upsertItemMetadata(
    { item: pinned, fileMtimeMs: fileMtimeForMeta },
    vaultId,
  );
}

async function syncParsedItemFromRawMarkdown(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  raw: string,
  fileMtimeMs: number,
  options?: { deferIndexRefresh?: boolean },
): Promise<ItemFile> {
  const item = await itemFileFromDocumentMarkdown(
    ctx.fs,
    vaultPath,
    vaultId,
    itemId,
    raw,
    fileMtimeMs,
  );

  await pinItemTagsToIndex(ctx, vaultPath, vaultId, item, fileMtimeMs, {
    preserveIndexSnapshot: options?.deferIndexRefresh === true,
  });

  if (!options?.deferIndexRefresh) {
    await refreshItemIndexAfterWrite(ctx, vaultPath, vaultId, item);
  }
  return item;
}

export async function upsertItem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  input: UpsertItemInput,
): Promise<ItemFile> {
  const timestamp = nowIso();
  const id = normalizeRelativePath(input.item.id);
  const body = input.content ?? "";
  const textStats = countTextStats(body);
  const item: ItemFile = {
    ...input.item,
    id,
    vault_id: vaultId,
    // Collections are real FS folders (#134): folder_path is always the
    // dirname of id, never an independent value supplied by the caller.
    folder_path: folderPathFromItemId(id),
    updated_at: timestamp,
    created_at: input.item.created_at || timestamp,
    word_count: textStats.wordCount,
    character_count: textStats.characterCount,
  };

  await writeItemDocument(ctx.fs, vaultPath, item, body);

  if (input.sourceRef) {
    await writeItemSourceRef(ctx.fs, vaultPath, item.id, input.sourceRef);
  }

  const docPath = itemMarkdownPath(vaultPath, id);
  const afterStat = await ctx.fs.stat(docPath);
  if (afterStat.mtimeMs === null) {
    throw new Error(`Cannot upsert item ${id}: missing file mtime after write`);
  }
  await pinItemTagsToIndex(ctx, vaultPath, vaultId, item, afterStat.mtimeMs, {
    preserveIndexSnapshot: input.deferIndexRefresh === true,
  });

  if (!input.deferIndexRefresh) {
    await refreshItemIndexAfterWrite(ctx, vaultPath, vaultId, item);
  }
  return item;
}

/**
 * Replace the vault `.md` with caller-supplied raw markdown (no re-serialize),
 * then re-parse into the index. Creates missing tags from frontmatter names.
 */
export async function writeItemRawMarkdown(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  raw: string,
  options?: { deferIndexRefresh?: boolean },
): Promise<ItemFile> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);
  if (!(await ctx.fs.exists(docPath))) {
    throw new Error(`Item not found: ${id}`);
  }

  const existingStat = await ctx.fs.stat(docPath);
  if (existingStat.mtimeMs === null) {
    throw new Error(`Cannot write item document ${id}: missing file mtime`);
  }

  await ctx.fs.writeText(docPath, raw);
  await ensureFileMtimeAdvanced(ctx.fs, docPath, existingStat.mtimeMs);
  await ctx.fs.touch(vaultPath);

  const afterStat = await ctx.fs.stat(docPath);
  if (afterStat.mtimeMs === null) {
    throw new Error(`Cannot write item document ${id}: missing file mtime after write`);
  }
  return syncParsedItemFromRawMarkdown(
    ctx,
    vaultPath,
    vaultId,
    id,
    raw,
    afterStat.mtimeMs,
    options,
  );
}

/**
 * Re-parse the existing vault `.md` bytes and sync catalog + index without
 * rewriting the document. Used when a higher layer persists "no-op" bytes but
 * still needs file-first tag/catalog/index reconciliation.
 */
export async function syncItemFromDisk(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  options?: { deferIndexRefresh?: boolean },
): Promise<ItemFile> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);
  if (!(await ctx.fs.exists(docPath))) {
    throw new Error(`Item not found: ${id}`);
  }

  const fileStat = await ctx.fs.stat(docPath);
  if (fileStat.mtimeMs === null) {
    throw new Error(`Cannot sync item document ${id}: missing file mtime`);
  }
  const raw = await ctx.fs.readText(docPath);
  return syncParsedItemFromRawMarkdown(
    ctx,
    vaultPath,
    vaultId,
    id,
    raw,
    fileStat.mtimeMs,
    options,
  );
}

export async function deleteItem(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const id = normalizeRelativePath(itemId);
  const vaultMeta = await readVaultMeta(ctx.fs, vaultPath);
  const [existingItem] = await ctx.index.listItemFilesByIds(vaultMeta.id, [id]);
  const releasedTagIds = existingItem?.tag_ids ?? [];
  const docPath = itemMarkdownPath(vaultPath, id);
  if (await ctx.fs.exists(docPath)) {
    await ctx.fs.remove(docPath);
  }
  const mediaRoot = noteSharedMediaRoot(vaultPath, noteUuidFromItemPath(id));
  if (await ctx.fs.exists(mediaRoot)) {
    await ctx.fs.remove(mediaRoot, { recursive: true });
  }
  await ctx.fs.touch(vaultPath);
  await ctx.index.deleteItem(id);
  if (releasedTagIds.length > 0) {
    await pruneReleasedTagsAfterIndexRefresh(
      ctx,
      vaultPath,
      vaultMeta.id,
      releasedTagIds,
    );
  }
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
    const readById = new Map(batchReads.map((read) => [read.id, read]));
    const tagMaps: TagMapsHolder = {
      maps: await loadTagMaps(ctx.fs, vaultPath),
    };
    for (const [index, itemId] of itemIds.entries()) {
      if (signal?.aborted) {
        return;
      }
      const batchRead = readById.get(itemId);
      let item: ItemFile | null = null;
      if (batchRead) {
        try {
          let diskMtimeMs =
            batchRead.mtimeMs === undefined ? null : batchRead.mtimeMs;
          if (diskMtimeMs === null) {
            diskMtimeMs = diskMtimeMsFromDocumentMarkdown(
              batchRead.documentMarkdown,
            );
          }
          item = await itemFileFromDocumentMarkdown(
            ctx.fs,
            vaultPath,
            vaultId,
            itemId,
            batchRead.documentMarkdown,
            diskMtimeMs,
            tagMaps,
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
