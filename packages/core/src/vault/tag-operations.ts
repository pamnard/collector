import type { ItemFile, Tag } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import { itemRoot } from "./paths.js";
import { readItemContent, readItemFile, writeItemFile } from "./item-io.js";
import { listTagsOnDisk, readTagsFile, writeTagsFile } from "./tag-io.js";

export interface TagWithCount extends Tag {
  item_count: number;
}

export async function syncTagsToIndex(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<void> {
  const tags = await listTagsOnDisk(ctx.fs, vaultPath);
  for (const tag of tags) {
    await ctx.index.upsertTag(tag, vaultId);
  }
}

export async function createTag(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  input: { name: string; color?: string | null },
): Promise<Tag> {
  const file = await readTagsFile(ctx.fs, vaultPath);
  const normalized = input.name.trim();
  if (file.tags.some((tag) => tag.name.toLowerCase() === normalized.toLowerCase())) {
    throw new Error(`Tag already exists: ${normalized}`);
  }

  const tag: Tag = {
    id: createId(),
    name: normalized,
    color: input.color ?? null,
    created_at: nowIso(),
  };

  file.tags.push(tag);
  await writeTagsFile(ctx.fs, vaultPath, file);
  await ctx.index.upsertTag(tag, vaultId);
  return tag;
}

export async function updateTag(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  tagId: string,
  input: { name?: string; color?: string | null },
): Promise<Tag> {
  const file = await readTagsFile(ctx.fs, vaultPath);
  const index = file.tags.findIndex((tag) => tag.id === tagId);
  if (index < 0) {
    throw new Error(`Tag not found: ${tagId}`);
  }

  const current = file.tags[index]!;
  if (input.name !== undefined) {
    const normalized = input.name.trim();
    if (
      file.tags.some(
        (tag) =>
          tag.id !== tagId && tag.name.toLowerCase() === normalized.toLowerCase(),
      )
    ) {
      throw new Error(`Tag already exists: ${normalized}`);
    }
    current.name = normalized;
  }

  if (input.color !== undefined) {
    current.color = input.color;
  }

  file.tags[index] = current;
  await writeTagsFile(ctx.fs, vaultPath, file);
  await ctx.index.upsertTag(current, vaultId);
  return current;
}

export async function deleteTag(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  tagId: string,
): Promise<void> {
  const file = await readTagsFile(ctx.fs, vaultPath);
  const nextTags = file.tags.filter((tag) => tag.id !== tagId);
  if (nextTags.length === file.tags.length) {
    throw new Error(`Tag not found: ${tagId}`);
  }

  const itemIds = await ctx.index.listItemIdsByTag(vaultId, tagId, {
    includeArchived: true,
  });

  await writeTagsFile(ctx.fs, vaultPath, { tags: nextTags });
  await ctx.index.deleteTag(tagId);

  for (const itemId of itemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    if (!(await ctx.fs.exists(itemPath))) {
      continue;
    }

    const item = await readItemFile(ctx.fs, itemPath);
    if (!item.tag_ids.includes(tagId)) {
      continue;
    }

    const updated: ItemFile = {
      ...item,
      tag_ids: item.tag_ids.filter((id) => id !== tagId),
      updated_at: nowIso(),
    };
    await writeItemFile(ctx.fs, itemPath, updated);
    const content = await readItemContent(ctx.fs, itemPath);
    await ctx.index.upsertItem({ item: updated, content, sourceRef: null }, vaultId);
  }
}

export async function listTagsWithCounts(
  ctx: VaultContext,
  vaultId: string,
  vaultPath: string,
): Promise<TagWithCount[]> {
  await syncTagsToIndex(ctx, vaultPath, vaultId);
  return ctx.index.listTagsWithCounts(vaultId);
}
