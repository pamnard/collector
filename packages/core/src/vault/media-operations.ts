import type { MediaFileMeta } from "@collector/shared";
import { inferMediaType } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import { itemMediaRoot } from "./paths.js";
import {
  listMediaFiles,
  mediaFilePath,
  readMediaManifest,
  writeMediaManifest,
} from "./media-io.js";

export interface MediaWithPath extends MediaFileMeta {
  absolute_path: string;
}

export async function attachMediaFile(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
  input: { filename: string; data: Uint8Array; mediaType?: MediaFileMeta["media_type"] },
): Promise<MediaFileMeta> {
  const manifest = await readMediaManifest(ctx.fs, vaultPath, itemId);
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

  manifest.files.push(entry);
  await writeMediaManifest(ctx.fs, vaultPath, itemId, manifest);
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
  const manifest = await readMediaManifest(ctx.fs, vaultPath, itemId);
  const target = manifest.files.find((file) => file.id === mediaId);
  if (!target) {
    throw new Error(`Media not found: ${mediaId}`);
  }

  const destination = mediaFilePath(vaultPath, itemId, mediaId, target.filename);
  if (await ctx.fs.exists(destination)) {
    await ctx.fs.remove(destination);
  }

  manifest.files = manifest.files.filter((file) => file.id !== mediaId);
  await writeMediaManifest(ctx.fs, vaultPath, itemId, manifest);
  await ctx.index.deleteMedia(mediaId);
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
