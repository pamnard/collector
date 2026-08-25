import type { MediaFileMeta } from "@collector/shared";
import { inferMediaType } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import { readVaultMeta, readItemFile } from "./item-io.js";
import { upsertItemIndexFromVault } from "./item-index-refresh.js";
import { itemMarkdownPath, itemMediaRoot } from "./paths.js";
import { listMediaFiles, mediaFilePath } from "./media-io.js";

export interface MediaWithPath extends MediaFileMeta {
  absolute_path: string;
}

/**
 * Ensure the parent item row exists before media FK insert.
 * createItem may defer index refresh to itemDerivedRefresh (#766/#776); attach
 * must not race that job (#817).
 */
async function ensureItemIndexedForMedia(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const vaultMeta = await readVaultMeta(ctx.fs, vaultPath);
  const [syncMeta] = await ctx.index.listItemSyncMetaByIds(vaultMeta.id, [
    itemId,
  ]);
  if (syncMeta) {
    return;
  }
  const docPath = itemMarkdownPath(vaultPath, itemId);
  if (!(await ctx.fs.exists(docPath))) {
    throw new Error(`Item not found: ${itemId}`);
  }
  const fileStat = await ctx.fs.stat(docPath);
  if (fileStat.mtimeMs === null) {
    throw new Error(`attachMediaFile: missing file mtime for ${itemId}`);
  }
  const item = await readItemFile(ctx.fs, vaultPath, itemId, vaultMeta.id);
  await upsertItemIndexFromVault(
    ctx,
    vaultPath,
    vaultMeta.id,
    itemId,
    item.content_revision,
    fileStat.mtimeMs,
  );
}

export async function attachMediaFile(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
  input: { filename: string; data: Uint8Array; mediaType?: MediaFileMeta["media_type"] },
): Promise<MediaFileMeta> {
  const mediaId = createId();
  const mediaType = input.mediaType ?? inferMediaType(input.filename);
  const entry: MediaFileMeta = {
    id: mediaId,
    item_id: itemId,
    filename: input.filename,
    media_type: mediaType,
    created_at: nowIso(),
  };

  const destination = mediaFilePath(vaultPath, itemId, mediaId, input.filename);
  await ctx.fs.mkdir(itemMediaRoot(vaultPath, itemId));
  await ctx.fs.writeBinary(destination, input.data);
  await ensureItemIndexedForMedia(ctx, vaultPath, itemId);
  await ctx.index.upsertMedia(entry);
  return entry;
}

export async function listItemMediaWithPaths(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<MediaWithPath[]> {
  const files = await listMediaFiles(ctx.fs, vaultPath, itemId);
  return files.map((file) => ({
    ...file,
    absolute_path: mediaFilePath(vaultPath, itemId, file.id, file.filename),
  }));
}

export async function deleteMediaFile(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
  mediaId: string,
): Promise<void> {
  const files = await listMediaFiles(ctx.fs, vaultPath, itemId);
  const target = files.find((file) => file.id === mediaId);
  if (!target) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  const destination = mediaFilePath(vaultPath, itemId, mediaId, target.filename);
  if (await ctx.fs.exists(destination)) {
    await ctx.fs.remove(destination);
  }

  await ctx.index.deleteMedia(mediaId);
}

export async function replaceMediaFile(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
  mediaId: string,
  input: { filename: string; data: Uint8Array; mediaType?: MediaFileMeta["media_type"] },
): Promise<MediaFileMeta> {
  const files = await listMediaFiles(ctx.fs, vaultPath, itemId);
  const previous = files.find((file) => file.id === mediaId);
  if (!previous) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  const oldPath = mediaFilePath(vaultPath, itemId, mediaId, previous.filename);
  if (await ctx.fs.exists(oldPath)) {
    await ctx.fs.remove(oldPath);
  }

  const mediaType = input.mediaType ?? inferMediaType(input.filename);
  const entry: MediaFileMeta = {
    id: mediaId,
    item_id: previous.item_id,
    filename: input.filename,
    media_type: mediaType,
    created_at: previous.created_at,
  };

  const destination = mediaFilePath(vaultPath, itemId, mediaId, input.filename);
  await ctx.fs.mkdir(itemMediaRoot(vaultPath, itemId));
  await ctx.fs.writeBinary(destination, input.data);
  await ctx.index.upsertMedia(entry);
  return entry;
}

export async function syncItemMediaToIndex(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const files = await listMediaFiles(ctx.fs, vaultPath, itemId);
  await ctx.index.deleteMediaForItem(itemId);
  for (const file of files) {
    await ctx.index.upsertMedia(file);
  }
}
