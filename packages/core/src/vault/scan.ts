import type { FileSystemAdapter } from "../adapters/types.js";
import { isMarkdownItemFile, isReservedVaultEntry, joinSegments } from "./paths.js";

/**
 * Walk the vault tree. Recurse only into directories. Markdown files are items;
 * non-reserved loose files are skipped. Reserved entries (incl. `*.media`) are
 * never folders or items.
 */
async function walkVault(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  relDir: string,
  onItem: (relPath: string) => void,
  onFolder: (relPath: string) => void,
): Promise<void> {
  const absDir = relDir ? joinSegments(vaultRootPath, relDir) : vaultRootPath;
  const entries = await fs.readDirEntries(absDir);
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith(".") || isReservedVaultEntry(name)) {
      continue;
    }
    const rel = relDir ? `${relDir}/${name}` : name;
    if (entry.isDirectory) {
      onFolder(rel);
      await walkVault(fs, vaultRootPath, rel, onItem, onFolder);
      continue;
    }
    if (isMarkdownItemFile(name)) {
      onItem(rel);
    }
  }
}

/** Vault-relative posix paths of every markdown item (recursive). */
export async function listItemRelativePaths(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<string[]> {
  if (!(await fs.exists(vaultRootPath))) {
    return [];
  }
  const items: string[] = [];
  await walkVault(
    fs,
    vaultRootPath,
    "",
    (rel) => items.push(rel),
    () => {},
  );
  return items;
}

/** Vault-relative posix paths of every real folder directory (recursive). */
export async function listFolderRelativePaths(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<string[]> {
  if (!(await fs.exists(vaultRootPath))) {
    return [];
  }
  const folders: string[] = [];
  await walkVault(
    fs,
    vaultRootPath,
    "",
    () => {},
    (rel) => folders.push(rel),
  );
  return folders.sort();
}
