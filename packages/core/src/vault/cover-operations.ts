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
  itemCoverPath,
  itemCoverRelativePath,
  itemMediaRoot,
  itemRoot,
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

  return joinSegments(itemRoot(vaultPath, itemId), thumbnail);
}

export async function applyItemCover(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  coverData: Uint8Array,
): Promise<ItemFile> {
  const itemPath = itemRoot(vaultPath, itemId);
  const coverPath = itemCoverPath(itemPath);

  await ctx.fs.mkdir(itemMediaRoot(itemPath));
  await ctx.fs.writeBinary(coverPath, coverData);

  const item = await readItemFile(ctx.fs, itemPath, vaultId);
  const updated: ItemFile = {
    ...item,
    thumbnail: itemCoverRelativePath(),
    updated_at: nowIso(),
  };
  await writeItemFile(ctx.fs, itemPath, updated);

  const content = await readItemContent(ctx.fs, itemPath, vaultId);
  const sourceRef = await readItemSourceRef(ctx.fs, itemPath);
  await ctx.index.upsertItem({ item: updated, content, sourceRef }, vaultId);
  return updated;
}

export async function clearItemCover(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
): Promise<ItemFile> {
  const itemPath = itemRoot(vaultPath, itemId);
  const coverPath = itemCoverPath(itemPath);

  if (await ctx.fs.exists(coverPath)) {
    await ctx.fs.remove(coverPath);
  }

  const item = await readItemFile(ctx.fs, itemPath, vaultId);
  if (!item.thumbnail) {
    return item;
  }

  const updated: ItemFile = {
    ...item,
    thumbnail: null,
    updated_at: nowIso(),
  };
  await writeItemFile(ctx.fs, itemPath, updated);

  const content = await readItemContent(ctx.fs, itemPath, vaultId);
  const sourceRef = await readItemSourceRef(ctx.fs, itemPath);
  await ctx.index.upsertItem({ item: updated, content, sourceRef }, vaultId);
  return updated;
}
