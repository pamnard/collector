import type { ItemFile } from "@collector/shared";
import type {
  ItemEmbeddingRefreshInput,
  VaultContext,
} from "../adapters/types.js";
import { loadTagMaps } from "./item-io.js";

export function tagNamesForItem(
  item: ItemFile,
  byId: Map<string, { name: string }>,
): string[] {
  const names: string[] = [];
  for (const tagId of item.tag_ids) {
    const tag = byId.get(tagId);
    if (tag) {
      names.push(tag.name);
    }
  }
  return names;
}

export function embeddingRefreshInputFromItem(
  item: ItemFile,
  tagNames: string[],
  body?: string | null,
): ItemEmbeddingRefreshInput {
  return {
    itemId: item.id,
    title: item.title,
    description: item.description,
    tagNames,
    body: body ?? undefined,
    contentRevision: item.content_revision,
  };
}

/** Best-effort embedding refresh after an item index write (#413 / #633). */
export async function refreshItemEmbeddingAfterWrite(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  body?: string | null,
): Promise<void> {
  if (ctx.embeddingRefreshJobs) {
    await ctx.embeddingRefreshJobs.enqueue(vaultId, [item.id]);
    return;
  }
  if (!ctx.embeddings) {
    return;
  }
  const maps = await loadTagMaps(ctx.fs, vaultPath);
  await ctx.embeddings.refresh([
    embeddingRefreshInputFromItem(
      item,
      tagNamesForItem(item, maps.byId),
      body,
    ),
  ]);
}
