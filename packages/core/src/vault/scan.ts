import type { FileSystemAdapter } from "../adapters/types.js";
import { isMarkdownItemFile, isReservedVaultEntry, joinSegments } from "./paths.js";

/**
 * Walk the vault tree using only `readDir`. Markdown files are items; any
 * non-reserved, non-dotfile, non-`*.media` entry is treated as a folder and
 * recursed into.
 */
async function walkVault(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  relDir: string,
  onItem: (relPath: string) => void,
  onFolder: (relPath: string) => void,
): Promise<void> {
  const absDir = relDir ? joinSegments(vaultRootPath, relDir) : vaultRootPath;
  const entries = await fs.readDir(absDir);
  for (const name of entries) {
    if (name.startsWith(".") || isReservedVaultEntry(name)) {
      continue;
    }
    const rel = relDir ? `${relDir}/${name}` : name;
    if (isMarkdownItemFile(name)) {
      onItem(rel);
      continue;
    }
    onFolder(rel);
    await walkVault(fs, vaultRootPath, rel, onItem, onFolder);
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
