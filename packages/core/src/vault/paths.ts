import { ITEM_FILES, VAULT_DIRS, VAULT_FILES } from "@collector/shared";

export function userRoot(dataDir: string, userId: string): string {
  return joinSegments(dataDir, "users", userId);
}

export function userVaultsRoot(dataDir: string, userId: string): string {
  return joinSegments(userRoot(dataDir, userId), "vaults");
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

export function joinSegments(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(/[/\\]+/))
    .filter(Boolean)
    .join("/");
}
