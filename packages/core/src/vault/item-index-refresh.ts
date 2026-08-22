import type { ItemFile } from "@collector/shared";
import type { ItemSyncMeta, VaultContext } from "../adapters/types.js";
import { ftsFieldsFromDocumentMarkdown } from "./frontmatter.js";
import {
  itemFileFromDocumentMarkdown,
  readItemSourceRef,
} from "./item-io.js";
import { itemMarkdownPath, normalizeRelativePath } from "./paths.js";
import { refreshItemEmbeddingAfterWrite } from "./item-embedding-refresh.js";
import { syncTagsToIndex } from "./tag-operations.js";

export type ItemIndexRefreshOutcome = "upserted" | "stale" | "missing";

export type ItemIndexRefreshHints = {
  /** Index-only field not stored in vault markdown. */
  collection_ids?: string[];
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
): Promise<ItemIndexRefreshOutcome> {
  const id = normalizeRelativePath(itemId);
  const docPath = itemMarkdownPath(vaultPath, id);

  if (!(await ctx.fs.exists(docPath))) {
    const [indexMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [id]);
    if (indexMeta) {
      await ctx.index.deleteItem(id);
    }
    return "missing";
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
    return "stale";
  }

  const fileStat = await ctx.fs.stat(docPath);
  if (fileStat.mtimeMs === null) {
    throw new Error(`Cannot index item ${id}: missing file mtime`);
  }

  // Job targeted an older on-disk generation; a newer enqueue covers current bytes.
  if (fileStat.mtimeMs > expectedFileMtimeMs) {
    return "stale";
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
    return "stale";
  }

  const [existingItem] = await ctx.index.listItemFilesByIds(vaultId, [id]);
  item = mergeIndexOnlyFields(item, existingItem, hints);

  await syncTagsToIndex(ctx, vaultPath, vaultId);

  const fts = ftsFieldsFromDocumentMarkdown(documentMarkdown);
  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, id);

  // Final TOCTOU gate: another writer may have advanced disk or index mid-flight.
  const reStat = await ctx.fs.stat(docPath);
  if (reStat.mtimeMs === null) {
    throw new Error(`Cannot index item ${id}: missing file mtime`);
  }
  if (reStat.mtimeMs !== fileStat.mtimeMs) {
    return "stale";
  }
  const [finalMeta] = await ctx.index.listItemSyncMetaByIds(vaultId, [id]);
  if (
    finalMeta &&
    isIndexAheadOfSnapshot(finalMeta, item.content_revision, fileStat.mtimeMs)
  ) {
    return "stale";
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
  return "upserted";
}

/** Enqueue or inline per-item index refresh after a vault write (#766). */
export async function refreshItemIndexAfterWrite(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
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
    );
    return;
  }
  await upsertItemIndexFromVault(
    ctx,
    vaultPath,
    vaultId,
    item.id,
    item.content_revision,
    fileStat.mtimeMs,
    { collection_ids: item.collection_ids },
  );
}
