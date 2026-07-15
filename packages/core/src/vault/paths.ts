import { ITEM_FILES, VAULT_DIRS, VAULT_FILES } from "@collector/shared";

export const RECONCILE_TOUCH_FILE = ".collector-touch";

const IGNORED_ITEMS_DIR_ENTRIES = new Set([RECONCILE_TOUCH_FILE]);

export function filterDiskItemIds(itemIds: string[]): string[] {
  return itemIds.filter((id) => !IGNORED_ITEMS_DIR_ENTRIES.has(id));
}

export function vaultsRoot(dataDir: string): string {
  return joinSegments(dataDir, "vaults");
}

export function vaultRoot(vaultsRoot: string, vaultId: string): string {
  return joinSegments(vaultsRoot, vaultId);
}

export function vaultMetaPath(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, VAULT_FILES.meta);
}

export function itemsRoot(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, VAULT_DIRS.items);
}

export function itemRoot(vaultRootPath: string, itemId: string): string {
  return joinSegments(itemsRoot(vaultRootPath), itemId);
}

export function itemMetaPath(itemRootPath: string): string {
  return joinSegments(itemRootPath, ITEM_FILES.meta);
}

export function itemContentPath(itemRootPath: string): string {
  return joinSegments(itemRootPath, ITEM_FILES.content);
}

export function itemSourcePath(itemRootPath: string): string {
  return joinSegments(itemRootPath, ITEM_FILES.source);
}

export function itemMediaRoot(itemRootPath: string): string {
  return joinSegments(itemRootPath, VAULT_DIRS.media);
}

export function itemCoverPath(itemRootPath: string): string {
  return joinSegments(itemMediaRoot(itemRootPath), ITEM_FILES.cover);
}

export function itemCoverRelativePath(): string {
  return joinSegments(VAULT_DIRS.media, ITEM_FILES.cover);
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
