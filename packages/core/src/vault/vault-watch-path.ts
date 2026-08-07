import { ITEM_MEDIA_SUFFIX, LEGACY_VAULT_DIRS, VAULT_DIRS } from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import {
  basename,
  isMarkdownItemFile,
  isReservedVaultEntry,
  isUuidMarkdownBasename,
} from "./paths.js";
import { listItemRelativePaths } from "./scan.js";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function toVaultRelativePath(vaultRootPath: string, changedPath: string): string | null {
  const root = normalizePath(vaultRootPath);
  const target = normalizePath(changedPath);
  if (target === root) {
    return null;
  }
  const prefix = `${root}/`;
  if (!target.startsWith(prefix)) {
    return null;
  }
  return target.slice(prefix.length);
}

const NOTE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `media/<noteUuid>/…` → noteUuid, or null. */
export function parseSharedMediaNoteUuid(relativePath: string): string | null {
  const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments[0] !== VAULT_DIRS.media || segments.length < 2) {
    return null;
  }
  const uuid = segments[1]!;
  if (!NOTE_UUID_RE.test(uuid)) {
    return null;
  }
  return uuid;
}

export type VaultWatchTarget =
  | { kind: "item"; itemId: string }
  | { kind: "folder"; folderPath: string };

/**
 * Sync classify a filesystem change under the vault root.
 * Shared `media/<uuid>/` needs {@link resolveVaultWatchTarget} (async lookup).
 */
export function classifyVaultWatchPath(
  vaultRootPath: string,
  changedPath: string,
): VaultWatchTarget | null {
  const relative = toVaultRelativePath(vaultRootPath, changedPath);
  if (!relative) {
    return null;
  }

  const segments = relative.split("/");
  if (segments[0] === LEGACY_VAULT_DIRS.items) {
    return null;
  }
  if (segments.length === 1 && isReservedVaultEntry(segments[0]!)) {
    return null;
  }

  // Shared media needs async resolve — do not treat as a folder.
  if (parseSharedMediaNoteUuid(relative)) {
    return null;
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.endsWith(ITEM_MEDIA_SUFFIX)) {
      const stem = segment.slice(0, -ITEM_MEDIA_SUFFIX.length);
      return {
        kind: "item",
        itemId: [...segments.slice(0, i), `${stem}.md`].join("/"),
      };
    }
  }

  if (isMarkdownItemFile(basename(relative))) {
    return { kind: "item", itemId: relative };
  }

  // Basename with a dot is a non-md file (or unknown dotted leaf), not a folder.
  if (basename(relative).includes(".")) {
    return null;
  }

  return { kind: "folder", folderPath: relative };
}

/**
 * Map a filesystem change under the vault root to the affected item id
 * (vault-relative `.md` path), or `null` if the change is not item-relevant.
 * A change inside an item's `*.media/` sidecar maps to the sibling `.md` file.
 * Shared `media/<uuid>/` needs {@link resolveVaultItemWatchPath} (async lookup).
 */
export function parseVaultItemWatchPath(
  vaultRootPath: string,
  changedPath: string,
): string | null {
  const target = classifyVaultWatchPath(vaultRootPath, changedPath);
  return target?.kind === "item" ? target.itemId : null;
}

/**
 * Resolve a vault FS change to an item id. Handles shared `media/<uuid>/…`
 * by finding any vault-relative `<uuid>.md` on disk (#279).
 */
export async function resolveVaultItemWatchPath(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  changedPath: string,
): Promise<string | null> {
  const target = await resolveVaultWatchTarget(fs, vaultRootPath, changedPath);
  return target?.kind === "item" ? target.itemId : null;
}

/**
 * Resolve a vault FS change to an item or folder watch target (#567).
 */
export async function resolveVaultWatchTarget(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  changedPath: string,
): Promise<VaultWatchTarget | null> {
  const syncHit = classifyVaultWatchPath(vaultRootPath, changedPath);
  if (syncHit) {
    return syncHit;
  }

  const relative = toVaultRelativePath(vaultRootPath, changedPath);
  if (!relative) {
    return null;
  }

  const noteUuid = parseSharedMediaNoteUuid(relative);
  if (!noteUuid) {
    return null;
  }

  const targetBase = `${noteUuid}.md`;
  const itemIds = await listItemRelativePaths(fs, vaultRootPath);
  const match = itemIds.find((id) => {
    const base = basename(id);
    return base.toLowerCase() === targetBase.toLowerCase() && isUuidMarkdownBasename(base);
  });
  return match ? { kind: "item", itemId: match } : null;
}
