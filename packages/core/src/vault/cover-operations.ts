import type { ItemFile } from "@collector/shared";
import { VAULT_DIRS } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import { ftsFieldsFromDocumentMarkdown } from "./frontmatter.js";
import {
  readItemFile,
  readItemSourceRef,
  writeItemFile,
} from "./item-io.js";
import {
  dirname,
  itemCoverPath,
  itemMarkdownPath,
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

async function persistItemPresentation(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  item: ItemFile,
): Promise<ItemFile> {
  const updated: ItemFile = {
    ...item,
    thumbnail: null,
    updated_at: nowIso(),
  };
  await writeItemFile(ctx.fs, vaultPath, updated);

  const documentMarkdown = await ctx.fs.readText(
    itemMarkdownPath(vaultPath, itemId),
  );
  const fts = ftsFieldsFromDocumentMarkdown(documentMarkdown);
  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, itemId);
  await ctx.index.upsertItem(
    {
      item: updated,
      content: fts.content,
      hasContentFile: fts.hasContentFile,
      sourceRef,
    },
    vaultId,
  );
  return updated;
}

/**
 * Bump item `updated_at` (and index) so dashboard/host thumbnail stamps invalidate
 * after media attach without waiting for cover (#720).
 */
export async function touchItemUpdatedAt(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
): Promise<ItemFile> {
  const item = await readItemFile(ctx.fs, vaultPath, itemId, vaultId);
  return persistItemPresentation(ctx, vaultPath, vaultId, itemId, item);
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
  // Always bump updated_at so preview stamps/caches cannot stick on null (#720).
  const item = await readItemFile(ctx.fs, vaultPath, itemId, vaultId);
  return persistItemPresentation(ctx, vaultPath, vaultId, itemId, item);
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

  // Drop leftover FM image paths from pre-#279 sidecars; always bump stamp (#720).
  const item = await readItemFile(ctx.fs, vaultPath, itemId, vaultId);
  return persistItemPresentation(ctx, vaultPath, vaultId, itemId, item);
}
