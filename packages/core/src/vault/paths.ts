import {
  ITEM_FILES,
  ITEM_MEDIA_SUFFIX,
  LEGACY_VAULT_DIRS,
  RESERVED_VAULT_ENTRIES,
  VAULT_DIRS,
  VAULT_FILES,
} from "@collector/shared";
import { folderPathFromItemPath } from "@collector/shared";

export const RECONCILE_TOUCH_FILE = ".collector-touch";

/** UUID stem for item filenames (`createId()` / `crypto.randomUUID()`). */
const ITEM_FILE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function vaultsRoot(dataDir: string): string {
  return joinSegments(dataDir, "vaults");
}

export function vaultRoot(vaultsRootPath: string, vaultId: string): string {
  return joinSegments(vaultsRootPath, vaultId);
}

export function vaultMetaPath(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, VAULT_FILES.meta);
}

export function vaultTagsPath(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, VAULT_FILES.tags);
}

/** Absolute path to a vault-relative item `.md` path. */
export function itemMarkdownPath(vaultRootPath: string, itemRelativePath: string): string {
  return joinSegments(vaultRootPath, normalizeRelativePath(itemRelativePath));
}

export function isMarkdownItemFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md") && !name.startsWith(".");
}

/** True when `name` is `<uuid>.md` (case-insensitive uuid). */
export function isUuidMarkdownBasename(name: string): boolean {
  if (!isMarkdownItemFile(name)) {
    return false;
  }
  return ITEM_FILE_UUID_RE.test(name.slice(0, -3));
}

/** UUID stem of an item `.md` path (`Inbox/<uuid>.md` → `<uuid>`). */
export function noteUuidFromItemPath(itemRelativePath: string): string {
  const base = basename(normalizeRelativePath(itemRelativePath));
  if (!isUuidMarkdownBasename(base)) {
    throw new Error(`Item path must be <uuid>.md: ${itemRelativePath}`);
  }
  return base.slice(0, -3);
}

/**
 * Legacy sibling sidecar dir name (`note.md` → `note.media`).
 * New writes use {@link noteSharedMediaRoot}; kept for watch/skip of leftovers.
 */
export function itemMediaDirName(itemRelativePath: string): string {
  const base = basename(itemRelativePath);
  if (!base.toLowerCase().endsWith(".md")) {
    throw new Error(`Item path must end with .md: ${itemRelativePath}`);
  }
  const stem = base.slice(0, -3);
  return `${stem}${ITEM_MEDIA_SUFFIX}`;
}

/** Shared vault media folder for a note uuid: `media/<noteUuid>/` (#276). */
export function noteSharedMediaRoot(
  vaultRootPath: string,
  noteUuid: string,
): string {
  const id = noteUuid.trim();
  if (!ITEM_FILE_UUID_RE.test(id)) {
    throw new Error(`noteUuid must be a UUID: ${noteUuid}`);
  }
  return joinSegments(vaultRootPath, VAULT_DIRS.media, id);
}

/** Absolute media root for an item: `media/<noteUuid>/` (#279). */
export function itemMediaRoot(
  vaultRootPath: string,
  itemRelativePath: string,
): string {
  return noteSharedMediaRoot(vaultRootPath, noteUuidFromItemPath(itemRelativePath));
}

export function itemSourcePath(vaultRootPath: string, itemRelativePath: string): string {
  return joinSegments(itemMediaRoot(vaultRootPath, itemRelativePath), ITEM_FILES.source);
}

export function itemCoverPath(vaultRootPath: string, itemRelativePath: string): string {
  return joinSegments(itemMediaRoot(vaultRootPath, itemRelativePath), ITEM_FILES.cover);
}

/** Vault-relative cover path for frontmatter thumbnail (#279). */
export function itemCoverRelativePath(itemRelativePath: string): string {
  const uuid = noteUuidFromItemPath(itemRelativePath);
  return joinSegments(VAULT_DIRS.media, uuid, ITEM_FILES.cover);
}

export function itemMediaManifestPath(
  vaultRootPath: string,
  itemRelativePath: string,
): string {
  return joinSegments(
    itemMediaRoot(vaultRootPath, itemRelativePath),
    ITEM_FILES.mediaManifest,
  );
}

export function folderPathFromItemId(itemRelativePath: string): string {
  return folderPathFromItemPath(normalizeRelativePath(itemRelativePath));
}

/** Legacy `items/` root (migration / detection only). */
export function legacyItemsRoot(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, LEGACY_VAULT_DIRS.items);
}

export function legacyItemRoot(vaultRootPath: string, itemUuid: string): string {
  return joinSegments(legacyItemsRoot(vaultRootPath), itemUuid);
}

export function legacyItemContentPath(itemRootPath: string): string {
  return joinSegments(itemRootPath, ITEM_FILES.legacyContent);
}

export function legacyItemMetaPath(itemRootPath: string): string {
  return joinSegments(itemRootPath, ITEM_FILES.legacyMeta);
}

export function legacyItemMediaRoot(itemRootPath: string): string {
  return joinSegments(itemRootPath, VAULT_DIRS.media);
}

export function legacyFoldersPath(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, VAULT_FILES.legacyFolders);
}

export function isReservedVaultEntry(name: string): boolean {
  return RESERVED_VAULT_ENTRIES.has(name) || name.endsWith(ITEM_MEDIA_SUFFIX);
}

export function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function basename(path: string): string {
  const normalized = normalizeRelativePath(path);
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

export function dirname(path: string): string {
  return folderPathFromItemPath(normalizeRelativePath(path));
}

export function joinSegments(...parts: string[]): string {
  const cleaned = parts.map((part) => part.replace(/\\/g, "/")).filter(Boolean);
  if (!cleaned.length) {
    return "";
  }

  let prefix = "";
  const rest = [...cleaned];

  if (rest[0]!.startsWith("/")) {
    prefix = "/";
    rest[0] = rest[0]!.slice(1);
  } else {
    const driveMatch = rest[0]!.match(/^([A-Za-z]:)(?:\/(.*))?$/);
    if (driveMatch) {
      prefix = `${driveMatch[1]}/`;
      rest[0] = driveMatch[2] ?? "";
      if (!rest[0]) {
        rest.shift();
      }
    }
  }

  const segments = rest.flatMap((part) => part.split("/")).filter(Boolean);
  return prefix + segments.join("/");
}

export { VAULT_DIRS, VAULT_FILES, ITEM_FILES, LEGACY_VAULT_DIRS, ITEM_MEDIA_SUFFIX };
