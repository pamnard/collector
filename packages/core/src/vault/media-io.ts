import { mediaManifestSchema, sanitizeMediaFilename } from "@collector/shared";
import type { MediaFileMeta, MediaManifest } from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { itemMediaManifestPath, itemMediaRoot, joinSegments } from "./paths.js";

export { itemMediaManifestPath as mediaManifestPath };

export function mediaStoredFilename(mediaId: string, originalFilename: string): string {
  return `${mediaId}-${sanitizeMediaFilename(originalFilename)}`;
}

export function mediaFilePath(
  vaultRootPath: string,
  itemRelativePath: string,
  mediaId: string,
  originalFilename: string,
): string {
  return joinSegments(
    itemMediaRoot(vaultRootPath, itemRelativePath),
    mediaStoredFilename(mediaId, originalFilename),
  );
}

export async function readMediaManifest(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<MediaManifest> {
  const path = itemMediaManifestPath(vaultRootPath, itemRelativePath);
  if (!(await fs.exists(path))) {
    return { files: [] };
  }

  const raw = await fs.readText(path);
  return mediaManifestSchema.parse(JSON.parse(raw));
}

export async function writeMediaManifest(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  manifest: MediaManifest,
): Promise<void> {
  const parsed = mediaManifestSchema.parse(manifest);
  await fs.mkdir(itemMediaRoot(vaultRootPath, itemRelativePath));
  await fs.writeText(
    itemMediaManifestPath(vaultRootPath, itemRelativePath),
    JSON.stringify(parsed, null, 2),
  );
}

export async function listMediaFiles(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<MediaFileMeta[]> {
  const manifest = await readMediaManifest(fs, vaultRootPath, itemRelativePath);
  return manifest.files.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
