import type { Tag } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { ensureTagsByName } from "../vault/item-io.js";

/**
 * Seed a catalog tag the same way document writes do (`ensureTagsByName`),
 * then upsert that row into the index (FK-ready for item metadata tests).
 */
export async function seedTagFromDocumentWritePath(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  name: string,
  options?: { syncToIndex?: boolean },
): Promise<Tag> {
  const maps = await ensureTagsByName(ctx.fs, vaultPath, [name]);
  const tag = maps.byName.get(name.toLowerCase());
  if (!tag) {
    throw new Error(`expected tag after ensureTagsByName: ${name}`);
  }
  if (options?.syncToIndex !== false) {
    await ctx.index.upsertTag(tag, vaultId);
  }
  return tag;
}
