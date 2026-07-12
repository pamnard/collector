import {
  ITEM_FILES,
  mediaManifestSchema,
  sanitizeMediaFilename,
} from "@collector/shared";
import type { MediaFileMeta, MediaManifest } from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { itemMediaRoot, joinSegments } from "./paths.js";

export function mediaManifestPath(itemRootPath: string): string {
  return joinSegments(itemMediaRoot(itemRootPath), ITEM_FILES.mediaManifest);
}

export function mediaStoredFilename(mediaId: string, originalFilename: string): string {
  return `${mediaId}-${sanitizeMediaFilename(originalFilename)}`;
}

export function mediaFilePath(
  itemRootPath: string,
  mediaId: string,
  originalFilename: string,
): string {
  return joinSegments(
    itemMediaRoot(itemRootPath),
    mediaStoredFilename(mediaId, originalFilename),
  );
}

export async function readMediaManifest(
  fs: FileSystemAdapter,
  itemRootPath: string,
): Promise<MediaManifest> {
  const path = mediaManifestPath(itemRootPath);
  if (!(await fs.exists(path))) {
    return { files: [] };
  }

  const raw = await fs.readText(path);
  return mediaManifestSchema.parse(JSON.parse(raw));
}

export async function writeMediaManifest(
  fs: FileSystemAdapter,
  itemRootPath: string,
  manifest: MediaManifest,
): Promise<void> {
  const parsed = mediaManifestSchema.parse(manifest);
  await fs.mkdir(itemMediaRoot(itemRootPath));
  await fs.writeText(mediaManifestPath(itemRootPath), JSON.stringify(parsed, null, 2));
}

export async function listMediaFiles(
  fs: FileSystemAdapter,
  itemRootPath: string,
): Promise<MediaFileMeta[]> {
  const manifest = await readMediaManifest(fs, itemRootPath);
  return manifest.files.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
