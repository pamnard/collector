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

/** Flush a batch of embedding inputs via durable jobs only (#633 / #639). */
export async function flushEmbeddingRefresh(
  ctx: VaultContext,
  vaultId: string,
  inputs: ItemEmbeddingRefreshInput[],
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  if (ctx.embeddingRefreshJobs) {
    await ctx.embeddingRefreshJobs.enqueue(vaultId, inputs);
    return;
  }
  if (ctx.embeddings) {
    throw new Error(
      "embedding refresh requires embeddingRefreshJobs (inline embeddings.refresh is removed)",
    );
  }
}

/** Best-effort embedding refresh after an item index write (#413 / #633). */
export async function refreshItemEmbeddingAfterWrite(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  item: ItemFile,
  body?: string | null,
): Promise<void> {
  if (!ctx.embeddingRefreshJobs && !ctx.embeddings) {
    return;
  }
  const maps = await loadTagMaps(ctx.fs, vaultPath);
  const inputs = [
    embeddingRefreshInputFromItem(
      item,
      tagNamesForItem(item, maps.byId),
      body,
    ),
  ];
  await flushEmbeddingRefresh(ctx, vaultId, inputs);
}
