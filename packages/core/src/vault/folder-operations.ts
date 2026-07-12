import type { ItemFile } from "@collector/shared";
import { isValidFolderPath, normalizeFolderPath } from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import {
  buildFolderTree,
  folderMatchesPrefix,
  renameFolderPath,
  type FolderTreeNode,
} from "./folder-tree.js";
import { readFoldersFile, writeFoldersFile } from "./folder-io.js";
import { itemRoot, itemsRoot } from "./paths.js";
import { readItemContent, readItemFile, writeItemFile } from "./item-io.js";

function assertFolderPath(path: string): string {
  const normalized = normalizeFolderPath(path);
  if (!isValidFolderPath(normalized)) {
    throw new Error(`Invalid folder path: ${path}`);
  }
  return normalized;
}

async function collectItemFolderPaths(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string[]> {
  const itemsDir = itemsRoot(vaultPath);
  if (!(await ctx.fs.exists(itemsDir))) {
    return [];
  }

  const paths: string[] = [];
  for (const itemId of await ctx.fs.readDir(itemsDir)) {
    const item = await readItemFile(ctx.fs, itemRoot(vaultPath, itemId));
    if (item.folder_path) {
      paths.push(item.folder_path);
    }
  }
  return paths;
}

export async function listFolderTree(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<FolderTreeNode[]> {
  const file = await readFoldersFile(ctx.fs, vaultPath);
  const itemPaths = await collectItemFolderPaths(ctx, vaultPath);
  const countRows = await ctx.index.listFolderItemCounts(vaultId);
  const counts = new Map(
    countRows.map((row) => [row.folder_path, row.item_count]),
  );
  const allPaths = [...file.paths, ...itemPaths, ...countRows.map((row) => row.folder_path)];
  return buildFolderTree(allPaths, counts);
}

export async function createFolder(
  ctx: VaultContext,
  vaultPath: string,
  path: string,
): Promise<string> {
  const normalized = assertFolderPath(path);
  const file = await readFoldersFile(ctx.fs, vaultPath);
  if (file.paths.includes(normalized)) {
    return normalized;
  }

  file.paths.push(normalized);
  await writeFoldersFile(ctx.fs, vaultPath, file);
  return normalized;
}

export async function renameFolder(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  oldPath: string,
  newPath: string,
): Promise<string> {
  const from = assertFolderPath(oldPath);
  const to = assertFolderPath(newPath);
  if (from === to) {
    return to;
  }

  const file = await readFoldersFile(ctx.fs, vaultPath);
  if (file.paths.includes(to)) {
    throw new Error(`Folder already exists: ${to}`);
  }

  file.paths = file.paths
    .map((entry) => renameFolderPath(entry, from, to))
    .filter(Boolean);
  if (!file.paths.includes(to)) {
    file.paths.push(to);
  }
  await writeFoldersFile(ctx.fs, vaultPath, file);

  const itemsDir = itemsRoot(vaultPath);
  if (await ctx.fs.exists(itemsDir)) {
    for (const itemId of await ctx.fs.readDir(itemsDir)) {
      const itemPath = itemRoot(vaultPath, itemId);
      const item = await readItemFile(ctx.fs, itemPath);
      const nextPath = renameFolderPath(item.folder_path, from, to);
      if (nextPath === item.folder_path) {
        continue;
      }

      const updated: ItemFile = {
        ...item,
        folder_path: nextPath,
        updated_at: nowIso(),
      };
      await writeItemFile(ctx.fs, itemPath, updated);
      const content = await readItemContent(ctx.fs, itemPath);
      await ctx.index.upsertItem({ item: updated, content, sourceRef: null }, vaultId);
    }
  }

  return to;
}

export async function deleteFolder(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  path: string,
): Promise<void> {
  const normalized = assertFolderPath(path);
  const counts = await ctx.index.listFolderItemCounts(vaultId);
  const hasItems = counts.some(
    (row) =>
      row.item_count > 0 && folderMatchesPrefix(row.folder_path, normalized),
  );
  if (hasItems) {
    throw new Error(`Folder is not empty: ${normalized}`);
  }

  const file = await readFoldersFile(ctx.fs, vaultPath);
  file.paths = file.paths.filter(
    (entry) => entry !== normalized && !entry.startsWith(`${normalized}/`),
  );
  await writeFoldersFile(ctx.fs, vaultPath, file);
}

export async function moveItemToFolder(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  folderPath: string,
): Promise<ItemFile> {
  const normalized = assertFolderPath(folderPath);
  const itemPath = itemRoot(vaultPath, itemId);
  const item = await readItemFile(ctx.fs, itemPath);
  const updated: ItemFile = {
    ...item,
    folder_path: normalized,
    updated_at: nowIso(),
  };
  await writeItemFile(ctx.fs, itemPath, updated);

  if (normalized) {
    const file = await readFoldersFile(ctx.fs, vaultPath);
    if (!file.paths.includes(normalized)) {
      file.paths.push(normalized);
      await writeFoldersFile(ctx.fs, vaultPath, file);
    }
  }

  const content = await readItemContent(ctx.fs, itemPath);
  await ctx.index.upsertItem({ item: updated, content, sourceRef: null }, vaultId);
  return updated;
}
