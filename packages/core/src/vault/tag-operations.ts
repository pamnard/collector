import type { ItemFile, Tag } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
  runWithConcurrency,
} from "../util/concurrency.js";
import { createId, nowIso } from "../util/ids.js";
import {
  buildTagMaps,
  parseItemDocument,
  serializeItemDocument,
} from "./item-document.js";
import { itemMarkdownPath } from "./paths.js";
import { listTagsOnDisk, readTagsFile, writeTagsFile } from "./tag-io.js";
import { readVaultItemMetaBatch } from "./vault-fs-batch.js";

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

  const itemIds = await ctx.index.listItemIdsByTag(vaultId, tagId);
  const reads = await readVaultItemMetaBatch(ctx.fs, vaultPath, itemIds);
  // Strip while tags.json still has the name so serialize can resolve remaining tags.
  const maps = buildTagMaps(file.tags);
  const updatedAt = nowIso();

  await runWithConcurrency(reads.length, DISK_ITEM_READ_CONCURRENCY, async (i) => {
    const read = reads[i]!;
    const docPath = itemMarkdownPath(vaultPath, read.id);
    const fileStat = await ctx.fs.stat(docPath);
    const fallbackIso =
      fileStat.mtimeMs !== null
        ? new Date(fileStat.mtimeMs).toISOString()
        : undefined;

    const parsed = parseItemDocument(read.documentMarkdown, {
      itemId: read.id,
      vaultId,
      tagsByName: maps.byName,
      fallbackCreatedAt: fallbackIso,
      fallbackUpdatedAt: fallbackIso,
    });
    if (parsed.missingTagNames.length > 0) {
      throw new Error(
        `Item document ${read.id} has unresolved tags: ${parsed.missingTagNames.join(", ")}`,
      );
    }
    if (!parsed.item.tag_ids.includes(tagId)) {
      return;
    }

    const updated: ItemFile = {
      ...parsed.item,
      tag_ids: parsed.item.tag_ids.filter((id) => id !== tagId),
      updated_at: updatedAt,
    };
    const markdown = serializeItemDocument(
      updated,
      parsed.body,
      maps.byId,
      parsed.extra,
    );
    await ctx.fs.writeText(docPath, markdown);

    const writtenStat = await ctx.fs.stat(docPath);
    if (writtenStat.mtimeMs === null) {
      throw new Error(`Missing mtime after writing item document: ${read.id}`);
    }
    // Timestamps only — deleteTag clears item_tags; upsertItemMetadata would wipe FTS body.
    await ctx.index.patchItemSyncMeta(read.id, {
      fileMtimeMs: writtenStat.mtimeMs,
      updatedAt: updated.updated_at,
      contentRevision: updated.content_revision,
      createdAt: updated.created_at,
    });
  });

  await ctx.fs.touch(vaultPath);
  await writeTagsFile(ctx.fs, vaultPath, { tags: nextTags });
  await ctx.index.deleteTag(tagId);
}

/** Tag list + counts from SQLite only (sidebar / navigation). */
export async function listTagsWithCounts(
  ctx: VaultContext,
  vaultId: string,
): Promise<TagWithCount[]> {
  return ctx.index.listTagsWithCounts(vaultId);
}
