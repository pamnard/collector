import type { ItemFile } from "@collector/shared";
import type { UpsertItemInput, VaultContext } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import {
  preferredStoredFormTagNames,
  serializeItemDocument,
} from "./item-document.js";
import { parseDocumentMarkdown } from "./frontmatter.js";
import {
  ensureTagsByName,
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  readItemFile,
  readItemRawMarkdown,
  readVaultMeta,
  writeItemDocument,
  writeItemSourceRef,
  type TagMapsHolder,
} from "./item-io.js";
import { resolveTagFromMaps, tagSimilarityKey } from "./tag-normalize.js";
import { withTagCatalogLock } from "./tag-catalog-lock.js";
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
  releasedTagIdsFromChange,
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
function sameTagIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

/** Non-empty trimmed tag names from document frontmatter (deduped by similarity). */
export function tagNamesFromFrontmatterTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const names: string[] = [];
  const seenKeys = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") {
      continue;
    }
    const name = raw.trim();
    if (!name) {
      continue;
    }
    const sim = tagSimilarityKey(name);
    if (seenKeys.has(sim)) {
      continue;
    }
    seenKeys.add(sim);
    names.push(name);
  }
  return names;
}

/**
 * Re-ensure FM tag names under the catalog lock, then pin item_tags.
 * Survives a full reconcile that dropped catalog rows between the first ensure
 * and this pin (race with vaultIndexSync kickoff prune).
 *
 * Prefer existing `item.tag_ids` that still exist in the catalog (same similarity
 * key as an FM name) so clone merge / item_count reconcile is not short-circuited.
 */
async function pinItemTagsToIndex(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  fileMtimeMs: number,
  options: {
    tagNames: readonly string[];
    preserveIndexSnapshot?: boolean;
  },
): Promise<ItemFile> {
  return withTagCatalogLock(vaultPath, async () => {
    const maps = await ensureTagsByName(
      ctx.fs,
      vaultPath,
      [...options.tagNames],
      undefined,
      { assumeCatalogLocked: true },
    );

    const fmKeys = new Set(
      options.tagNames.map((name) => tagSimilarityKey(name)),
    );
    const tagIds: string[] = [];
    const keptKeys = new Set<string>();
    for (const tagId of item.tag_ids) {
      const tag = maps.byId.get(tagId);
      if (!tag) {
        continue;
      }
      const key = tagSimilarityKey(tag.name);
      if (!fmKeys.has(key) || keptKeys.has(key)) {
        continue;
      }
      tagIds.push(tagId);
      keptKeys.add(key);
    }
    for (const rawName of options.tagNames) {
      const key = tagSimilarityKey(rawName);
      if (keptKeys.has(key)) {
        continue;
      }
      const tag = resolveTagFromMaps(maps.byName, rawName);
      if (!tag) {
        continue;
      }
      tagIds.push(tag.id);
      keptKeys.add(key);
    }
    const withTags: ItemFile = { ...item, tag_ids: tagIds };

    await syncTagsToIndex(ctx, vaultPath, vaultId, { tagIds: withTags.tag_ids });
    const [existing] = await ctx.index.listItemFilesByIds(vaultId, [
      withTags.id,
    ]);
    const preserve =
      options.preserveIndexSnapshot === true && existing !== undefined;
    let fileMtimeForMeta = fileMtimeMs;
    if (preserve) {
      const [syncMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [
        withTags.id,
      ]);
      if (syncMeta?.file_mtime_ms != null) {
        fileMtimeForMeta = syncMeta.file_mtime_ms;
      }
    }
    const pinned: ItemFile = {
      ...withTags,
      collection_ids: existing?.collection_ids ?? withTags.collection_ids,
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
    return pinned;
  });
}

/**
 * Capture releases before pin, pin item_tags, then refresh and/or prune.
 *
 * - Always prune immediately from the pre-pin snapshot (same as main): orphan
 *   catalog tags must not wait on a derived job that may fail permanently.
 * - With `itemDerivedRefreshJobs`: also enqueue derived refresh with
 *   `previousTagIds` (media-only localize prune insurance).
 * - With `deferIndexRefresh`: prune immediately; caller owns derived enqueue.
 * - Tag names default from on-disk FM so pin can recreate catalog rows after
 *   a concurrent full reconcile.
 */
async function pinRefreshAndPruneItemTags(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  fileMtimeMs: number,
  options?: { deferIndexRefresh?: boolean; tagNames?: readonly string[] },
): Promise<ItemFile> {
  const [beforeItem] = await ctx.index.listItemFilesByIds(vaultId, [item.id]);
  const previousTagIds = beforeItem?.tag_ids ?? [];

  let tagNames = options?.tagNames ? [...options.tagNames] : undefined;
  if (tagNames === undefined) {
    const raw = await readItemRawMarkdown(ctx.fs, vaultPath, item.id);
    tagNames = tagNamesFromFrontmatterTags(
      parseDocumentMarkdown(raw).frontmatter.tags,
    );
  }

  const pinnedItem = await pinItemTagsToIndex(
    ctx,
    vaultPath,
    vaultId,
    item,
    fileMtimeMs,
    {
      tagNames,
      preserveIndexSnapshot: options?.deferIndexRefresh === true,
    },
  );
  const released = releasedTagIdsFromChange(
    previousTagIds,
    pinnedItem.tag_ids,
  );

  if (options?.deferIndexRefresh === true) {
    await pruneReleasedTagsAfterIndexRefresh(
      ctx,
      vaultPath,
      vaultId,
      released,
    );
    return pinnedItem;
  }

  await refreshItemIndexAfterWrite(
    ctx,
    vaultPath,
    vaultId,
    pinnedItem,
    ctx.itemDerivedRefreshJobs ? { previousTagIds } : undefined,
  );
  // Immediate prune from pre-pin snapshot even when refresh only enqueued a job.
  await pruneReleasedTagsAfterIndexRefresh(ctx, vaultPath, vaultId, released);
  return pinnedItem;
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
  // Raw write always refreshes: body/FTS may change even when tag_ids match.
  return pinRefreshAndPruneItemTags(
    ctx,
    vaultPath,
    vaultId,
    item,
    fileMtimeMs,
    {
      ...options,
      tagNames: tagNamesFromFrontmatterTags(
        parseDocumentMarkdown(raw).frontmatter.tags,
      ),
    },
  );
}

/**
 * After parse/ensure: short-circuit when item_tags already match, otherwise
 * pin + refresh/prune. Shared by raw write, disk sync, and canonical no-op.
 */
async function reconcileParsedItemWithIndex(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  fileMtimeMs: number,
  options?: { deferIndexRefresh?: boolean; tagNames?: readonly string[] },
): Promise<ItemFile> {
  const [existing] = await ctx.index.listItemFilesByIds(vaultId, [item.id]);
  if (existing && sameTagIds(existing.tag_ids, item.tag_ids)) {
    await syncTagsToIndex(ctx, vaultPath, vaultId, { tagIds: item.tag_ids });
    return {
      ...item,
      collection_ids: existing.collection_ids,
    };
  }

  const pinned = await pinRefreshAndPruneItemTags(
    ctx,
    vaultPath,
    vaultId,
    item,
    fileMtimeMs,
    options,
  );
  return {
    ...pinned,
    collection_ids: existing?.collection_ids ?? pinned.collection_ids,
  };
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
  return pinRefreshAndPruneItemTags(
    ctx,
    vaultPath,
    vaultId,
    item,
    afterStat.mtimeMs,
    { deferIndexRefresh: input.deferIndexRefresh === true },
  );
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
 * rewriting the document. Used for file-first tag/catalog/index reconciliation
 * when a higher layer persists no-op bytes (#948).
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
  const item = await itemFileFromDocumentMarkdown(
    ctx.fs,
    vaultPath,
    vaultId,
    id,
    raw,
    fileStat.mtimeMs,
  );
  return reconcileParsedItemWithIndex(
    ctx,
    vaultPath,
    vaultId,
    item,
    fileStat.mtimeMs,
    {
      ...options,
      tagNames: tagNamesFromFrontmatterTags(
        parseDocumentMarkdown(raw).frontmatter.tags,
      ),
    },
  );
}

/**
 * UI source-editor save: parse frontmatter, ensure/normalize tags (#943),
 * re-serialize canonical frontmatter, write only when bytes differ from disk.
 * Import/sync paths keep using writeItemRawMarkdown (raw bytes contract).
 *
 * Already-stored-form tag spellings from `raw` are preferred on re-serialize
 * so content-path updates keep file FM spelling (#949) while legacy names
 * still canonicalize via tagStoredForm (#947).
 *
 * Even when bytes are unchanged (`wrote: false`), catalog + index still sync
 * from the parsed file so ensure/rename cannot leave SQL behind (#948).
 */
export async function writeItemCanonicalSourceMarkdown(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  raw: string,
  options?: { deferIndexRefresh?: boolean },
): Promise<{ item: ItemFile; wrote: boolean }> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);
  if (!(await ctx.fs.exists(docPath))) {
    throw new Error(`Item not found: ${id}`);
  }

  const existingStat = await ctx.fs.stat(docPath);
  if (existingStat.mtimeMs === null) {
    throw new Error(`Cannot write item document ${id}: missing file mtime`);
  }

  const existing = await readItemRawMarkdown(ctx.fs, vaultPath, id);
  const item = await itemFileFromDocumentMarkdown(
    ctx.fs,
    vaultPath,
    vaultId,
    id,
    raw,
    existingStat.mtimeMs,
  );
  const parsedRaw = parseDocumentMarkdown(raw);
  const body = parsedRaw.body;
  const fmTagNames = tagNamesFromFrontmatterTags(parsedRaw.frontmatter.tags);
  const maps = await loadTagMaps(ctx.fs, vaultPath);
  const preferredTagNames = preferredStoredFormTagNames(
    parsedRaw.frontmatter.tags,
  );
  const canonical = serializeItemDocument(item, body, maps.byId, {
    preferredTagNames,
  });

  if (canonical === existing) {
    const synced = await reconcileParsedItemWithIndex(
      ctx,
      vaultPath,
      vaultId,
      item,
      existingStat.mtimeMs,
      { ...options, tagNames: fmTagNames },
    );
    return { item: synced, wrote: false };
  }

  await writeItemDocument(ctx.fs, vaultPath, item, body, {
    tagsById: maps.byId,
    preferredTagNames,
  });
  await ensureFileMtimeAdvanced(ctx.fs, docPath, existingStat.mtimeMs);
  await ctx.fs.touch(vaultPath);

  const afterStat = await ctx.fs.stat(docPath);
  if (afterStat.mtimeMs === null) {
    throw new Error(
      `Cannot write item document ${id}: missing file mtime after write`,
    );
  }

  const pinned = await pinRefreshAndPruneItemTags(
    ctx,
    vaultPath,
    vaultId,
    item,
    afterStat.mtimeMs,
    { ...options, tagNames: fmTagNames },
  );
  return { item: pinned, wrote: true };
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
