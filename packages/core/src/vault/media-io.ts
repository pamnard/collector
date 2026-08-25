import {
  ITEM_FILES,
  inferMediaType,
  mediaManifestSchema,
  sanitizeMediaFilename,
} from "@collector/shared";
import type { MediaFileMeta, MediaManifest } from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { sha1Bytes } from "../util/sha1.js";
import {
  itemMediaManifestPath,
  itemMediaRoot,
  joinSegments,
} from "./paths.js";

export { itemMediaManifestPath as mediaManifestPath };

const ATTACHED_MEDIA_FILENAME_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i;

const SKIP_MEDIA_DIR_NAMES = new Set<string>([
  ITEM_FILES.source,
  ITEM_FILES.cover,
  ITEM_FILES.coverSize,
  ITEM_FILES.mediaManifest,
]);

/** Fixed namespace for bare media file ids under `media/<uuid>/` (#279). */
const BARE_MEDIA_ID_NAMESPACE = "a1c0ffee-2790-45a0-9e5d-000000000279";

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID for v5 namespace: ${uuid}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function uuidV5(name: string, namespaceUuid: string): string {
  const hash = sha1Bytes([
    uuidToBytes(namespaceUuid),
    new TextEncoder().encode(name),
  ]);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return bytesToUuid(hash.subarray(0, 16));
}

/** Stable `MediaFileMeta.id` for files without `{mediaId}-` prefix (#279). */
export function bareMediaFileId(itemId: string, filename: string): string {
  return uuidV5(`${itemId}\0${filename}`, BARE_MEDIA_ID_NAMESPACE);
}

export function mediaStoredFilename(mediaId: string, originalFilename: string): string {
  return `${mediaId}-${sanitizeMediaFilename(originalFilename)}`;
}

export function mediaFilePath(
  vaultRootPath: string,
  itemRelativePath: string,
  mediaId: string,
  originalFilename: string,
): string {
  const root = itemMediaRoot(vaultRootPath, itemRelativePath);
  if (mediaId === bareMediaFileId(itemRelativePath, originalFilename)) {
    return joinSegments(root, originalFilename);
  }
  return joinSegments(root, mediaStoredFilename(mediaId, originalFilename));
}

/** @deprecated Manifest is not the source of truth for gallery (#279). */
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

/** @deprecated Do not write on attach/list (#279). */
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

function shouldSkipMediaDirEntry(name: string): boolean {
  if (!name || name.startsWith(".")) {
    return true;
  }
  return SKIP_MEDIA_DIR_NAMES.has(name);
}

function createdAtFromMtime(mtimeMs: number | null): string {
  if (mtimeMs == null) {
    throw new Error("Media file stat missing mtimeMs");
  }
  return new Date(mtimeMs).toISOString();
}

export async function listMediaFiles(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<MediaFileMeta[]> {
  const root = itemMediaRoot(vaultRootPath, itemRelativePath);
  if (!(await fs.exists(root))) {
    return [];
  }

  const entries = await fs.readDirEntries(root);
  const files: MediaFileMeta[] = [];

  for (const entry of entries) {
    const name = entry.name;
    if (shouldSkipMediaDirEntry(name) || entry.isDirectory) {
      continue;
    }
    const absolute = joinSegments(root, name);

    const attached = name.match(ATTACHED_MEDIA_FILENAME_RE);
    const mediaId = attached ? attached[1]! : bareMediaFileId(itemRelativePath, name);
    const filename = attached ? attached[2]! : name;
    const { mtimeMs } = await fs.stat(absolute);

    files.push({
      id: mediaId,
      item_id: itemRelativePath,
      filename,
      media_type: inferMediaType(filename),
      created_at: createdAtFromMtime(mtimeMs),
    });
  }

  return files.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Absolute path of the gallery image used for thumbnail fallback (#711).
 *
 * Contract: among non-skipped file entries whose stored name is an image,
 * pick the **lexicographic minimum** of the directory entry name. This is
 * intentional and deterministic — not `readDirEntries` order and not
 * `created_at`/mtime order from {@link listMediaFiles}.
 *
 * Cost: one `exists(root)` + one `readDirEntries`; trusts the listing (no
 * per-candidate `exists`/`stat`). Non-images are skipped in memory only.
 */
export async function findFirstGalleryImagePath(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<string | null> {
  return findFirstGalleryPathByMediaType(
    fs,
    vaultRootPath,
    itemRelativePath,
    "image",
  );
}

/** Lex-min gallery video entry (#711 ordering), same scan rules as images. */
export async function findFirstGalleryVideoPath(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
): Promise<string | null> {
  return findFirstGalleryPathByMediaType(
    fs,
    vaultRootPath,
    itemRelativePath,
    "video",
  );
}

async function findFirstGalleryPathByMediaType(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemRelativePath: string,
  mediaType: "image" | "video",
): Promise<string | null> {
  const root = itemMediaRoot(vaultRootPath, itemRelativePath);
  if (!(await fs.exists(root))) {
    return null;
  }

  const entries = await fs.readDirEntries(root);
  let bestName: string | null = null;
  for (const entry of entries) {
    const name = entry.name;
    if (shouldSkipMediaDirEntry(name) || entry.isDirectory) {
      continue;
    }
    if (inferMediaType(name) !== mediaType) {
      continue;
    }
    if (bestName === null || name < bestName) {
      bestName = name;
    }
  }

  return bestName === null ? null : joinSegments(root, bestName);
}
