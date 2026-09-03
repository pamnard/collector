import type { ItemFile } from "@collector/shared";
import type { ItemSyncMeta, VaultContext } from "../adapters/types.js";
import { ftsFieldsFromDocumentMarkdown } from "./frontmatter.js";
import {
  itemFileFromDocumentMarkdown,
  readItemSourceRef,
} from "./item-io.js";
import { itemMarkdownPath, normalizeRelativePath } from "./paths.js";
import { refreshItemEmbeddingAfterWrite } from "./item-embedding-refresh.js";
import { pruneTagCatalogCandidates } from "./tag-catalog-prune.js";
import { syncTagsToIndex } from "./tag-operations.js";

export type ItemIndexRefreshOutcome = "upserted" | "stale" | "missing";

export type ItemIndexRefreshResult = {
  outcome: ItemIndexRefreshOutcome;
  /** Tag ids no longer on this item after the refresh (candidates for prune). */
  releasedTagIds: string[];
};

export type ItemIndexRefreshHints = {
  /** Index-only field not stored in vault markdown. */
  collection_ids?: string[];
  /** Indexed tag ids before the current write pinned new metadata. */
  previousTagIds?: string[];
};

function mergeIndexOnlyFields(
  item: ItemFile,
  existing: ItemFile | undefined,
  hints?: ItemIndexRefreshHints,
): ItemFile {
  const collection_ids =
    hints?.collection_ids ?? existing?.collection_ids ?? item.collection_ids;
  if (collection_ids === item.collection_ids) {
    return item;
  }
  return { ...item, collection_ids };
}

/** Tag ids on the previous item row but absent after this write (#935/#944). */
export function releasedTagIdsFromChange(
  previous: readonly string[] | undefined,
  next: readonly string[],
): string[] {
  if (!previous || previous.length === 0) {
    return [];
  }
  const nextSet = new Set(next);
  return previous.filter((id) => !nextSet.has(id));
}

/** True when indexed row is strictly newer than this snapshot (rev, then mtime). */
export function isIndexAheadOfSnapshot(
  meta: Pick<ItemSyncMeta, "content_revision" | "file_mtime_ms">,
  contentRevision: number,
  fileMtimeMs: number,
): boolean {
  if (meta.content_revision > contentRevision) {
    return true;
  }
  if (meta.content_revision < contentRevision) {
    return false;
  }
  return meta.file_mtime_ms != null && meta.file_mtime_ms > fileMtimeMs;
}

/**
 * Upsert one item into the SQL/FTS index from current vault bytes.
 * Skips when the index already reflects a newer snapshot (#766).
 * Re-checks mtime immediately before write to close TOCTOU races.
 */
export async function upsertItemIndexFromVault(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  expectedContentRevision: number,
  expectedFileMtimeMs: number,
  hints?: ItemIndexRefreshHints,
): Promise<ItemIndexRefreshResult> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);

  if (!(await ctx.fs.exists(docPath))) {
    const [existingItem] = await ctx.index.listItemFilesByIds(vaultId, [id]);
    const [indexMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [id]);
    if (indexMeta) {
      await ctx.index.deleteItem(id);
    }
    return {
      outcome: "missing",
      releasedTagIds: existingItem?.tag_ids ?? [],
    };
  }

  const [indexMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [id]);
  if (
    indexMeta &&
    isIndexAheadOfSnapshot(
      indexMeta,
      expectedContentRevision,
      expectedFileMtimeMs,
    )
  ) {
    return { outcome: "stale", releasedTagIds: [] };
  }

  const fileStat = await ctx.fs.stat(docPath);
  if (fileStat.mtimeMs === null) {
    throw new Error(`Cannot index item ${id}: missing file mtime`);
  }

  // Job targeted an older on-disk generation; a newer enqueue covers current bytes.
  if (fileStat.mtimeMs > expectedFileMtimeMs) {
    return { outcome: "stale", releasedTagIds: [] };
  }

  const documentMarkdown = await ctx.fs.readText(docPath);
  let item = await itemFileFromDocumentMarkdown(
    ctx.fs,
    vaultPath,
    vaultId,
    id,
    documentMarkdown,
    fileStat.mtimeMs,
  );

  const [freshMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [id]);
  if (
    freshMeta &&
    isIndexAheadOfSnapshot(freshMeta, item.content_revision, fileStat.mtimeMs)
  ) {
    return { outcome: "stale", releasedTagIds: [] };
  }

  const [existingItem] = await ctx.index.listItemFilesByIds(vaultId, [id]);
  item = mergeIndexOnlyFields(item, existingItem, hints);
  // Prefer write-path hint: pin may already have replaced item_tags.
  const released = releasedTagIdsFromChange(
    hints?.previousTagIds ?? existingItem?.tag_ids,
    item.tag_ids,
  );

  await syncTagsToIndex(ctx, vaultPath, vaultId, { tagIds: item.tag_ids });

  const fts = ftsFieldsFromDocumentMarkdown(documentMarkdown);
  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, id);

  // Final TOCTOU gate: another writer may have advanced disk or index mid-flight.
  const reStat = await ctx.fs.stat(docPath);
  if (reStat.mtimeMs === null) {
    throw new Error(`Cannot index item ${id}: missing file mtime`);
  }
  if (reStat.mtimeMs !== fileStat.mtimeMs) {
    return { outcome: "stale", releasedTagIds: [] };
  }
  const [finalMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [id]);
  if (
    finalMeta &&
    isIndexAheadOfSnapshot(finalMeta, item.content_revision, fileStat.mtimeMs)
  ) {
    return { outcome: "stale", releasedTagIds: [] };
  }

  await ctx.index.upsertItem(
    {
      item,
      content: fts.content,
      hasContentFile: fts.hasContentFile,
      sourceRef,
      fileMtimeMs: fileStat.mtimeMs,
    },
    vaultId,
  );
  await refreshItemEmbeddingAfterWrite(
    ctx,
    vaultPath,
    vaultId,
    item,
    fts.content,
  );
  return { outcome: "upserted", releasedTagIds: released };
}

/**
 * After index item_tags reflect the new set: enqueue or inline prune (#935).
 * No-op when nothing was released.
 */
export async function pruneReleasedTagsAfterIndexRefresh(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  releasedTagIds: readonly string[],
): Promise<void> {
  if (releasedTagIds.length === 0) {
    return;
  }
  if (ctx.tagCatalogPruneJobs) {
    await ctx.tagCatalogPruneJobs.enqueue(vaultId, vaultPath, releasedTagIds);
    return;
  }
  await pruneTagCatalogCandidates(ctx, vaultPath, vaultId, releasedTagIds);
}

/** Enqueue or inline per-item index refresh after a vault write (#766). */
export async function refreshItemIndexAfterWrite(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  hints?: ItemIndexRefreshHints,
): Promise<void> {
  const docPath = itemMarkdownPath(vaultPath, item.id);
  const fileStat = await ctx.fs.stat(docPath);
  if (fileStat.mtimeMs === null) {
    throw new Error(
      `Cannot refresh index for ${item.id}: missing file mtime after write`,
    );
  }
  if (ctx.itemDerivedRefreshJobs) {
    await ctx.itemDerivedRefreshJobs.enqueue(
      vaultId,
      vaultPath,
      item.id,
      item.content_revision,
      fileStat.mtimeMs,
      item.url,
      hints?.previousTagIds,
    );
    return;
  }
  const { releasedTagIds } = await upsertItemIndexFromVault(
    ctx,
    vaultPath,
    vaultId,
    item.id,
    item.content_revision,
    fileStat.mtimeMs,
    {
      collection_ids: item.collection_ids,
      previousTagIds: hints?.previousTagIds,
    },
  );
  await pruneReleasedTagsAfterIndexRefresh(
    ctx,
    vaultPath,
    vaultId,
    releasedTagIds,
  );
}
