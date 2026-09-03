/**
 * Merge catalog tags that share a similarity key (#943).
 *
 * Must run under withTagCatalogLock. Rewrites item frontmatter + item_tags
 * onto the winner, then drops loser rows from tags.json and the SQL index.
 */
import type { ItemFile, Tag } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { readItemContent, writeItemDocument } from "./item-io.js";
import { itemMarkdownPath } from "./paths.js";
import { readTagsFile, writeTagsFile } from "./tag-io.js";
import {
  preferTagForSimilarityMap,
  tagSimilarityKey,
  tagStoredForm,
} from "./tag-normalize.js";

function pickWinner(group: Tag[], counts: Map<string, number>): Tag {
  return group.reduce((winner, candidate) => {
    const cw = counts.get(winner.id) ?? 0;
    const cc = counts.get(candidate.id) ?? 0;
    if (cc !== cw) {
      return cc > cw ? candidate : winner;
    }
    return preferTagForSimilarityMap(winner, candidate);
  });
}

function remapTagIds(
  tagIds: string[],
  loserIds: Set<string>,
  winnerId: string,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of tagIds) {
    const mapped = loserIds.has(id) ? winnerId : id;
    if (seen.has(mapped)) {
      continue;
    }
    seen.add(mapped);
    next.push(mapped);
  }
  return next;
}

async function pinRemappedItem(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  tagsById: Map<string, Tag>,
): Promise<{ item: ItemFile; fileMtimeMs: number }> {
  for (const tagId of item.tag_ids) {
    const tag = tagsById.get(tagId);
    if (!tag) {
      throw new Error(
        `Cannot pin remapped tags for ${item.id}: missing catalog tag ${tagId}`,
      );
    }
    await ctx.index.upsertTag(tag, vaultId);
  }
  const docPath = itemMarkdownPath(vaultPath, item.id);
  const stat = await ctx.fs.stat(docPath);
  if (stat.mtimeMs === null) {
    throw new Error(`Missing mtime after tag remap write: ${item.id}`);
  }
  return { item, fileMtimeMs: stat.mtimeMs };
}

/**
 * Rename every catalog row onto normalize(name).storedForm and rewrite linked
 * items so frontmatter cannot keep legacy forms like `A/B`.
 * Caller must hold withTagCatalogLock.
 */
export async function canonicalizeCatalogStoredForms(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<{ renamedTagIds: string[] }> {
  const file = await readTagsFile(ctx.fs, vaultPath);
  const renamed: Tag[] = [];
  const nextTags = file.tags.map((tag) => {
    const stored = tagStoredForm(tag.name);
    if (tag.name === stored) {
      return tag;
    }
    const updated = { ...tag, name: stored };
    renamed.push(updated);
    return updated;
  });
  if (renamed.length === 0) {
    return { renamedTagIds: [] };
  }

  await writeTagsFile(ctx.fs, vaultPath, { tags: nextTags });
  const tagsById = new Map(nextTags.map((tag) => [tag.id, tag]));

  for (const tag of renamed) {
    await ctx.index.upsertTag(tag, vaultId);
    const itemIds = await ctx.index.listItemIdsByTag(vaultId, tag.id);
    if (itemIds.length === 0) {
      continue;
    }
    const indexedItems = await ctx.index.listItemFilesByIds(vaultId, itemIds);
    const metadataBatch: Array<{ item: ItemFile; fileMtimeMs: number }> = [];
    for (const indexed of indexedItems) {
      const body = (await readItemContent(ctx.fs, vaultPath, indexed.id)) ?? "";
      await writeItemDocument(ctx.fs, vaultPath, indexed, body, {
        tagsById,
        assumeCatalogLocked: true,
      });
      metadataBatch.push(
        await pinRemappedItem(ctx, vaultPath, vaultId, indexed, tagsById),
      );
    }
    if (metadataBatch.length > 0) {
      await ctx.index.upsertItemMetadataBatch(metadataBatch, vaultId);
    }
  }

  return { renamedTagIds: renamed.map((tag) => tag.id) };
}

/**
 * Group tags by similarity key; merge clones onto winner.
 * Caller must hold withTagCatalogLock for this vaultPath.
 */
export async function mergeTagSimilarityClones(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<{ mergedLoserIds: string[] }> {
  const file = await readTagsFile(ctx.fs, vaultPath);
  const groups = new Map<string, Tag[]>();
  for (const tag of file.tags) {
    const key = tagSimilarityKey(tag.name);
    const group = groups.get(key);
    if (group) {
      group.push(tag);
    } else {
      groups.set(key, [tag]);
    }
  }

  const cloneGroups = [...groups.values()].filter((g) => g.length > 1);
  if (cloneGroups.length === 0) {
    return { mergedLoserIds: [] };
  }

  const counts = new Map<string, number>();
  for (const row of await ctx.index.listTagsWithCounts(vaultId)) {
    counts.set(row.id, row.item_count);
  }

  const tagsById = new Map(file.tags.map((tag) => [tag.id, tag]));
  const mergedLoserIds: string[] = [];

  for (const group of cloneGroups) {
    const winner = pickWinner(group, counts);
    const losers = group.filter((tag) => tag.id !== winner.id);
    const loserIds = new Set(losers.map((tag) => tag.id));

    // Include winner-linked items too: after sync, item_tags may already point
    // at the map winner while frontmatter still stores a loser catalog name.
    const itemIdSet = new Set<string>();
    for (const tag of group) {
      for (const itemId of await ctx.index.listItemIdsByTag(vaultId, tag.id)) {
        itemIdSet.add(itemId);
      }
    }

    const itemIds = [...itemIdSet];
    const indexedItems =
      itemIds.length === 0
        ? []
        : await ctx.index.listItemFilesByIds(vaultId, itemIds);
    if (indexedItems.length !== itemIds.length) {
      const found = new Set(indexedItems.map((item) => item.id));
      const missing = itemIds.find((id) => !found.has(id));
      throw new Error(
        `Tag similarity merge references missing index item ${missing}`,
      );
    }

    const metadataBatch: Array<{ item: ItemFile; fileMtimeMs: number }> = [];
    for (const indexed of indexedItems) {
      const nextTagIds = remapTagIds(indexed.tag_ids, loserIds, winner.id);
      const nextItem = { ...indexed, tag_ids: nextTagIds };
      const body = (await readItemContent(ctx.fs, vaultPath, indexed.id)) ?? "";
      // Always rewrite so FM stores the winner's catalog name (#943).
      await writeItemDocument(ctx.fs, vaultPath, nextItem, body, {
        tagsById,
        assumeCatalogLocked: true,
      });
      metadataBatch.push(
        await pinRemappedItem(ctx, vaultPath, vaultId, nextItem, tagsById),
      );
    }
    if (metadataBatch.length > 0) {
      await ctx.index.upsertItemMetadataBatch(metadataBatch, vaultId);
    }

    for (const loser of losers) {
      mergedLoserIds.push(loser.id);
    }
  }

  if (mergedLoserIds.length === 0) {
    return { mergedLoserIds: [] };
  }

  const drop = new Set(mergedLoserIds);
  const nextTags = file.tags.filter((tag) => !drop.has(tag.id));
  await writeTagsFile(ctx.fs, vaultPath, { tags: nextTags });
  for (const tagId of mergedLoserIds) {
    await ctx.index.deleteTag(tagId);
  }

  return { mergedLoserIds };
}
