import type { MediaFileMeta } from "@collector/shared";
import { inferMediaType } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import { readVaultMeta, readItemFile } from "./item-io.js";
import { upsertItemIndexFromVault } from "./item-index-refresh.js";
import {
  itemMarkdownPath,
  itemMediaRoot,
  normalizeRelativePath,
} from "./paths.js";
import { listMediaFiles, mediaFilePath } from "./media-io.js";

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let i = 0; i < left.byteLength; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export interface MediaWithPath extends MediaFileMeta {
  absolute_path: string;
}

/** Catch-up attempts when concurrent derived refresh races TOCTOU gates (#828). */
const ENSURE_ITEM_INDEXED_ATTEMPTS = 3;

/**
 * Ensure the parent item row exists before media FK insert.
 * createItem may defer index refresh to itemDerivedRefresh (#766/#776); attach
 * must not race that job (#828). Verifies the row landed — ignoring a stale
 * catch-up outcome previously left upsertMedia to fail with opaque FK errors.
 */
async function ensureItemIndexedForMedia(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const id = normalizeRelativePath(itemId);
  const vaultMeta = await readVaultMeta(ctx.fs, vaultPath);
  const docPath = itemMarkdownPath(vaultPath, id);

  for (let attempt = 0; ; attempt++) {
    const [syncMeta] = await ctx.index.listItemSyncMetaByIds(vaultMeta.id, [
      id,
    ]);
    if (syncMeta) {
      return;
    }
    if (attempt >= ENSURE_ITEM_INDEXED_ATTEMPTS) {
      throw new Error(`Item not in index: ${id}`);
    }

    if (!(await ctx.fs.exists(docPath))) {
      throw new Error(`Item not found: ${id}`);
    }
    const fileStat = await ctx.fs.stat(docPath);
    if (fileStat.mtimeMs === null) {
      throw new Error(`attachMediaFile: missing file mtime for ${id}`);
    }
    const item = await readItemFile(ctx.fs, vaultPath, id, vaultMeta.id);
    const outcome = await upsertItemIndexFromVault(
      ctx,
      vaultPath,
      vaultMeta.id,
      id,
      item.content_revision,
      fileStat.mtimeMs,
    );
    if (outcome.outcome === "missing") {
      throw new Error(`Item not found: ${id}`);
    }
    // "upserted" or "stale": re-check. Stale may mean a concurrent derived job
    // advanced disk mid-flight (retry with a fresh snapshot) or already wrote
    // the row (next listItemSyncMetaByIds hits).
  }
}

/**
 * Attach bytes to an item. Idempotent by content: if the note already has a
 * file with the same bytes, return that entry (no second disk write / id).
 */
export async function attachMediaFile(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
  input: { filename: string; data: Uint8Array; mediaType?: MediaFileMeta["media_type"] },
): Promise<MediaFileMeta> {
  const existing = await listMediaFiles(ctx.fs, vaultPath, itemId);
  for (const file of existing) {
    const path = mediaFilePath(vaultPath, itemId, file.id, file.filename);
    const fileStat = await ctx.fs.stat(path);
    // Adapter returns nulls when the path is missing — skip without a separate exists().
    if (fileStat.mtimeMs == null) {
      continue;
    }
    if (
      fileStat.sizeBytes != null &&
      fileStat.sizeBytes !== input.data.byteLength
    ) {
      continue;
    }
    const onDisk = await ctx.fs.readBinary(path);
    if (sameBytes(onDisk, input.data)) {
      return file;
    }
  }

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
  await ensureItemIndexedForMedia(ctx, vaultPath, itemId);
  await ctx.index.upsertMedia(entry);
  return entry;
}

export async function syncItemMediaToIndex(
  ctx: VaultContext,
  vaultPath: string,
  itemId: string,
): Promise<void> {
  const files = await listMediaFiles(ctx.fs, vaultPath, itemId);
  await ensureItemIndexedForMedia(ctx, vaultPath, itemId);
  await ctx.index.deleteMediaForItem(itemId);
  for (const file of files) {
    await ctx.index.upsertMedia(file);
  }
}
