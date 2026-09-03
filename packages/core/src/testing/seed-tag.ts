import type { Tag } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { ensureTagsByName } from "../vault/item-io.js";
import { resolveTagFromMaps } from "../vault/tag-normalize.js";

/** Seed a catalog tag via `ensureTagsByName`, then upsert into the index. */
export async function seedTagFromDocumentWritePath(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  name: string,
  options?: { syncToIndex?: boolean },
): Promise<Tag> {
  const maps = await ensureTagsByName(ctx.fs, vaultPath, [name]);
  const tag = resolveTagFromMaps(maps.byName, name);
  if (!tag) {
    throw new Error(`expected tag after ensureTagsByName: ${name}`);
  }
  if (options?.syncToIndex !== false) {
    await ctx.index.upsertTag(tag, vaultId);
  }
  return tag;
}
