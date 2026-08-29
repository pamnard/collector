import type { CoverPixelSize, CoverSource, ItemFile } from "@collector/shared";
import { coverPixelSizeSchema, coverSourceSchema, VAULT_DIRS } from "@collector/shared";
import type { FileSystemAdapter, VaultContext } from "../adapters/types.js";
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
  itemCoverSizePath,
  itemCoverSourcePath,
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

  const docPath = itemMarkdownPath(vaultPath, itemId);
  const fileStat = await ctx.fs.stat(docPath);
  if (fileStat.mtimeMs === null) {
    throw new Error(
      `persistItemPresentation: missing file mtimeMs for indexed item ${itemId}`,
    );
  }

  const documentMarkdown = await ctx.fs.readText(docPath);
  const fts = ftsFieldsFromDocumentMarkdown(documentMarkdown);
  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, itemId);
  await ctx.index.upsertItem(
    {
      item: updated,
      content: fts.content,
      hasContentFile: fts.hasContentFile,
      sourceRef,
      fileMtimeMs: fileStat.mtimeMs,
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

export async function writeItemCoverSize(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemId: string,
  size: CoverPixelSize,
): Promise<void> {
  const parsed = coverPixelSizeSchema.parse(size);
  const sizePath = itemCoverSizePath(vaultPath, itemId);
  await fs.writeText(sizePath, `${JSON.stringify(parsed)}\n`);
}

/**
 * Read persisted cover WxH beside cover.webp.
 * Returns null when the sidecar is absent (caller may backfill).
 * Invalid sidecar JSON/schema fails fast.
 */
export async function readItemCoverSize(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemId: string,
): Promise<CoverPixelSize | null> {
  const sizePath = itemCoverSizePath(vaultPath, itemId);
  if (!(await fs.exists(sizePath))) {
    return null;
  }
  const raw = await fs.readText(sizePath);
  return coverPixelSizeSchema.parse(JSON.parse(raw));
}

export async function writeItemCoverSource(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemId: string,
  source: CoverSource,
): Promise<void> {
  const parsed = coverSourceSchema.parse(source);
  const sourcePath = itemCoverSourcePath(vaultPath, itemId);
  await fs.writeText(sourcePath, `${JSON.stringify(parsed)}\n`);
}

/**
 * MediaId that produced cover.webp. Null when sidecar missing (legacy covers).
 * Invalid JSON/schema fails fast.
 */
export async function readItemCoverSource(
  fs: FileSystemAdapter,
  vaultPath: string,
  itemId: string,
): Promise<CoverSource | null> {
  const sourcePath = itemCoverSourcePath(vaultPath, itemId);
  if (!(await fs.exists(sourcePath))) {
    return null;
  }
  const raw = await fs.readText(sourcePath);
  return coverSourceSchema.parse(JSON.parse(raw));
}

export async function applyItemCover(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  coverData: Uint8Array,
  size: CoverPixelSize,
  options?: { sourceMediaId?: string; sourceFilename?: string },
): Promise<ItemFile> {
  const coverPath = itemCoverPath(vaultPath, itemId);

  await ctx.fs.mkdir(itemMediaRoot(vaultPath, itemId));
  await ctx.fs.writeBinary(coverPath, coverData);
  await writeItemCoverSize(ctx.fs, vaultPath, itemId, size);
  const sourcePath = itemCoverSourcePath(vaultPath, itemId);
  if (options?.sourceMediaId) {
    await writeItemCoverSource(ctx.fs, vaultPath, itemId, {
      mediaId: options.sourceMediaId,
      ...(options.sourceFilename
        ? { filename: options.sourceFilename }
        : {}),
    });
  } else if (await ctx.fs.exists(sourcePath)) {
    await ctx.fs.remove(sourcePath);
  }

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
  const sizePath = itemCoverSizePath(vaultPath, itemId);
  const sourcePath = itemCoverSourcePath(vaultPath, itemId);

  if (await ctx.fs.exists(coverPath)) {
    await ctx.fs.remove(coverPath);
  }
  if (await ctx.fs.exists(sizePath)) {
    await ctx.fs.remove(sizePath);
  }
  if (await ctx.fs.exists(sourcePath)) {
    await ctx.fs.remove(sourcePath);
  }

  // Drop leftover FM image paths from pre-#279 sidecars; always bump stamp (#720).
  const item = await readItemFile(ctx.fs, vaultPath, itemId, vaultId);
  return persistItemPresentation(ctx, vaultPath, vaultId, itemId, item);
}
