import type { ItemFile } from "@collector/shared";
import { VAULT_DIRS } from "@collector/shared";
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
  itemMediaRoot,
  joinSegments,
  normalizeRelativePath,
} from "./paths.js";

/** Resolve a thumbnail string to an absolute path (legacy helper; preview uses cover on disk). */
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

  const relative = normalizeRelativePath(thumbnail);
  if (relative === VAULT_DIRS.media || relative.startsWith(`${VAULT_DIRS.media}/`)) {
    return joinSegments(vaultPath, relative);
  }

  // Legacy sidecar-relative thumbnails (pre-#279 / until #281).
  const folder = dirname(itemId);
  return folder
    ? joinSegments(vaultPath, folder, relative)
    : joinSegments(vaultPath, relative);
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

  // Cover SoT is the file on disk (#276); do not store vault image paths in FM.
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

  // Drop leftover FM image paths from pre-#279 sidecars.
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
