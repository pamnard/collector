import { ITEM_MEDIA_SUFFIX, LEGACY_VAULT_DIRS } from "@collector/shared";
import { basename, isMarkdownItemFile, isReservedVaultEntry } from "./paths.js";

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

/**
 * Map a filesystem change under the vault root to the affected item id
 * (vault-relative `.md` path), or `null` if the change is not item-relevant.
 * A change inside an item's `*.media/` sidecar maps to the sibling `.md` file.
 */
export function parseVaultItemWatchPath(
  vaultRootPath: string,
  changedPath: string,
): string | null {
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

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.endsWith(ITEM_MEDIA_SUFFIX)) {
      const stem = segment.slice(0, -ITEM_MEDIA_SUFFIX.length);
      return [...segments.slice(0, i), `${stem}.md`].join("/");
    }
  }

  if (isMarkdownItemFile(basename(relative))) {
    return relative;
  }

  return null;
}
