/**
 * Document-derived tag catalog prune / reconcile (#935).
 *
 * Workers (or inline paths without the job port) drop catalog entries and
 * index tag rows that have zero remaining item_tags references. Mutates
 * tags.json under withTagCatalogLock (re-read before write).
 */
import type { VaultContext } from "../adapters/types.js";
import { withTagCatalogLock } from "./tag-catalog-lock.js";
import { readTagsFile, writeTagsFile } from "./tag-io.js";

async function tagHasItemRefs(
  ctx: VaultContext,
  vaultId: string,
  tagId: string,
): Promise<boolean> {
  const refs = await ctx.index.listItemIdsByTag(vaultId, tagId, { limit: 1 });
  return refs.length > 0;
}

/**
 * Drop candidate tag ids that have zero item_tags refs from tags.json + index.
 * No-op for ids still linked to any indexed item.
 */
export async function pruneTagCatalogCandidates(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  candidateTagIds: readonly string[],
): Promise<{ prunedTagIds: string[] }> {
  if (candidateTagIds.length === 0) {
    return { prunedTagIds: [] };
  }

  const unique = [...new Set(candidateTagIds)];
  const unused: string[] = [];
  for (const tagId of unique) {
    if (!(await tagHasItemRefs(ctx, vaultId, tagId))) {
      unused.push(tagId);
    }
  }
  if (unused.length === 0) {
    return { prunedTagIds: [] };
  }

  const unusedSet = new Set(unused);
  const prunedTagIds: string[] = [];
  await withTagCatalogLock(vaultPath, async () => {
    const file = await readTagsFile(ctx.fs, vaultPath);
    // Re-check refs inside the lock: a concurrent write may have re-linked
    // a name; only drop ids that are still unused.
    for (const tagId of unusedSet) {
      if (await tagHasItemRefs(ctx, vaultId, tagId)) {
        continue;
      }
      prunedTagIds.push(tagId);
    }
    if (prunedTagIds.length === 0) {
      return;
    }
    const drop = new Set(prunedTagIds);
    const nextTags = file.tags.filter((tag) => !drop.has(tag.id));
    if (nextTags.length !== file.tags.length) {
      await writeTagsFile(ctx.fs, vaultPath, { tags: nextTags });
    }
    for (const tagId of prunedTagIds) {
      await ctx.index.deleteTag(tagId);
    }
  });

  return { prunedTagIds };
}

/**
 * Rewrite tags.json to currently referenced tags and delete orphan index rows.
 */
export async function reconcileTagCatalog(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<{ prunedTagIds: string[] }> {
  return withTagCatalogLock(vaultPath, async () => {
    const referenced = new Set(await ctx.index.listReferencedTagIds(vaultId));
    const file = await readTagsFile(ctx.fs, vaultPath);
    const kept = file.tags.filter((tag) => referenced.has(tag.id));
    if (kept.length !== file.tags.length) {
      await writeTagsFile(ctx.fs, vaultPath, { tags: kept });
    }
    const orphanIndexIds = await ctx.index.listOrphanTagIds(vaultId);
    for (const tagId of orphanIndexIds) {
      await ctx.index.deleteTag(tagId);
    }
    return { prunedTagIds: orphanIndexIds };
  });
}

/**
 * Run incremental prune when candidates are provided; otherwise full reconcile.
 */
export async function runTagCatalogPrune(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  candidateTagIds?: readonly string[],
): Promise<{ prunedTagIds: string[] }> {
  if (candidateTagIds === undefined) {
    return reconcileTagCatalog(ctx, vaultPath, vaultId);
  }
  return pruneTagCatalogCandidates(ctx, vaultPath, vaultId, candidateTagIds);
}
