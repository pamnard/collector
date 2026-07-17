import type { ItemFile } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import {
  readItemContent,
  readItemFile,
  readItemSourceRef,
  writeItemFile,
} from "./item-io.js";
import {
  dirname,
  itemCoverPath,
  itemCoverRelativePath,
  itemMediaRoot,
  joinSegments,
} from "./paths.js";

export function resolveItemThumbnailAbsolutePath(
  vaultPath: string,
  itemId: string,
  thumbnail: string | null | undefined,
): string | null {
  if (!thumbnail) {
    return null;
  }

  if (thumbnail.startsWith("/") || /^[A-Za-z]:/.test(thumbnail)) {
    return thumbnail;
  }

  const folder = dirname(itemId);
  return folder
    ? joinSegments(vaultPath, folder, thumbnail)
    : joinSegments(vaultPath, thumbnail);
}

export async function applyItemCover(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  coverData: Uint8Array,
): Promise<ItemFile> {
  const coverPath = itemCoverPath(vaultPath, itemId);

  await ctx.fs.mkdir(itemMediaRoot(vaultPath, itemId));
  await ctx.fs.writeBinary(coverPath, coverData);

  const item = await readItemFile(ctx.fs, vaultPath, itemId, vaultId);
  const updated: ItemFile = {
    ...item,
    thumbnail: itemCoverRelativePath(itemId),
    updated_at: nowIso(),
  };
  await writeItemFile(ctx.fs, vaultPath, updated);

  const content = await readItemContent(ctx.fs, vaultPath, itemId);
  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, itemId);
  await ctx.index.upsertItem({ item: updated, content, sourceRef }, vaultId);
  return updated;
}

export async function clearItemCover(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
): Promise<ItemFile> {
  const coverPath = itemCoverPath(vaultPath, itemId);

  if (await ctx.fs.exists(coverPath)) {
    await ctx.fs.remove(coverPath);
  }

  const item = await readItemFile(ctx.fs, vaultPath, itemId, vaultId);
  if (!item.thumbnail) {
    return item;
  }

  const updated: ItemFile = {
    ...item,
    thumbnail: null,
    updated_at: nowIso(),
  };
  await writeItemFile(ctx.fs, vaultPath, updated);

  const content = await readItemContent(ctx.fs, vaultPath, itemId);
  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, itemId);
  await ctx.index.upsertItem({ item: updated, content, sourceRef }, vaultId);
  return updated;
}
