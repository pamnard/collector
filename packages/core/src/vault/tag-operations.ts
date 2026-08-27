/**
 * Tag catalog ops (#842).
 *
 * Product rule: aggregated tag lists are derived from document frontmatter
 * tag names only. Tags enter `tags.json` / the index via document writes
 * (`ensureTagsByName` during item create/update/source). There is no vault
 * API to create, rename, or delete catalog entries independently, and no
 * list→documents mass rewrite.
 *
 * `listTagsWithCounts` only returns tags currently linked to indexed items;
 * orphan catalog/index rows are omitted from the list.
 */
import type { Tag } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { listTagsOnDisk } from "./tag-io.js";

export interface TagWithCount extends Tag {
  item_count: number;
}

export interface SyncTagsToIndexOptions {
  /**
   * When set, upsert only these tag ids (per-item FK rows before item upsert).
   * Omit for full vault tag rebuild (vault index sync).
   */
  tagIds?: string[];
}

/**
 * Upsert tag rows into the SQL index from tags.json on disk.
 * Per-item saves pass `tagIds` so unchanged vault tags are not re-upserted (#776).
 * When `itemDerivedRefreshJobs` is wired, RPC paths defer tag sync entirely;
 * `upsertItemIndexFromVault` syncs the item's tag_ids before upsert (FK invariant).
 */
export async function syncTagsToIndex(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  options?: SyncTagsToIndexOptions,
): Promise<void> {
  const tags = await listTagsOnDisk(ctx.fs, vaultPath);
  const tagIdFilter =
    options?.tagIds !== undefined ? new Set(options.tagIds) : null;
  for (const tag of tags) {
    if (tagIdFilter && !tagIdFilter.has(tag.id)) {
      continue;
    }
    await ctx.index.upsertTag(tag, vaultId);
  }
}

/** Tag list + counts from SQLite only (sidebar / navigation). */
export async function listTagsWithCounts(
  ctx: VaultContext,
  vaultId: string,
): Promise<TagWithCount[]> {
  return ctx.index.listTagsWithCounts(vaultId);
}
