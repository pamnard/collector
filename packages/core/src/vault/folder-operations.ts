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
import { filterDiskItemIds, itemRoot, itemsRoot } from "./paths.js";
import { readItemContent, readItemFile, writeItemFile } from "./item-io.js";
import { streamItemsByIds } from "./operations.js";

function assertFolderPath(path: string): string {
  const normalized = normalizeFolderPath(path);
  if (!isValidFolderPath(normalized)) {
    throw new Error(`Invalid folder path: ${path}`);
  }
  return normalized;
}

/** Folder paths from item documents on disk (parallel source for tree merge). */
export async function collectItemFolderPaths(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string[]> {
  const itemsDir = itemsRoot(vaultPath);
  if (!(await ctx.fs.exists(itemsDir))) {
    return [];
  }

  const itemIds = filterDiskItemIds(await ctx.fs.readDir(itemsDir));
  const paths: string[] = [];
  await streamItemsByIds(ctx, vaultPath, itemIds, {
    onItem: ({ item }) => {
      if (item?.folder_path) {
        paths.push(item.folder_path);
      }
    },
  });
  return paths;
}

export function mergeFolderCountRows(
  indexRows: Array<{ folder_path: string; item_count: number }> | null,
  diskFolderPaths: string[] | null,
): Array<{ folder_path: string; item_count: number }> {
  const counts = new Map<string, number>();

  if (indexRows) {
    for (const row of indexRows) {
      counts.set(row.folder_path, row.item_count);
    }
  }

  if (diskFolderPaths) {
    const diskCounts = new Map<string, number>();
    for (const path of diskFolderPaths) {
      diskCounts.set(path, (diskCounts.get(path) ?? 0) + 1);
    }
    if (!indexRows) {
      return [...diskCounts.entries()].map(([folder_path, item_count]) => ({
        folder_path,
        item_count,
      }));
    }
    for (const [path, count] of diskCounts) {
      if (!counts.has(path)) {
        counts.set(path, count);
      }
    }
  }

  return [...counts.entries()].map(([folder_path, item_count]) => ({
    folder_path,
    item_count,
  }));
}

export function buildFolderTreeFromSources(
  foldersFilePaths: string[],
  countRows: Array<{ folder_path: string; item_count: number }>,
  diskItemFolderPaths: string[] = [],
): FolderTreeNode[] {
  const counts = new Map(
    countRows.map((row) => [row.folder_path, row.item_count]),
  );
  const allPaths = [
    ...foldersFilePaths,
    ...countRows.map((row) => row.folder_path),
    ...diskItemFolderPaths,
  ];
  return buildFolderTree(allPaths, counts);
}

export async function readVaultFolderPaths(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string[]> {
  const file = await readFoldersFile(ctx.fs, vaultPath);
  return file.paths;
}

export function publishFolderTreeFromLayers(
  foldersFilePaths: string[],
  indexCountRows: Array<{ folder_path: string; item_count: number }> | null,
  diskFolderPaths: string[] | null,
): FolderTreeNode[] {
  return buildFolderTreeFromSources(
    foldersFilePaths,
    mergeFolderCountRows(indexCountRows, diskFolderPaths),
    diskFolderPaths ?? [],
  );
}

/** SQLite counts + folders.json (no item disk scan). */
export async function listFolderTreeFromIndex(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<FolderTreeNode[]> {
  const file = await readFoldersFile(ctx.fs, vaultPath);
  const countRows = await ctx.index.listFolderItemCounts(vaultId);
  return buildFolderTreeFromSources(file.paths, countRows);
}

/** Authoritative merge: union folder paths from disk item documents. */
export async function reconcileFolderTreeFromDisk(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<FolderTreeNode[]> {
  const file = await readFoldersFile(ctx.fs, vaultPath);
  const itemPaths = await collectItemFolderPaths(ctx, vaultPath);
  const countRows = await ctx.index.listFolderItemCounts(vaultId);
  return buildFolderTreeFromSources(file.paths, countRows, itemPaths);
}

export async function listFolderTree(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<FolderTreeNode[]> {
  return reconcileFolderTreeFromDisk(ctx, vaultPath, vaultId);
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

  const itemIds = await ctx.index.listItemIdsByFolderPrefix(vaultId, from, {
    includeArchived: true,
  });

  for (const itemId of itemIds) {
    const itemPath = itemRoot(vaultPath, itemId);
    if (!(await ctx.fs.exists(itemPath))) {
      continue;
    }

    const item = await readItemFile(ctx.fs, itemPath, vaultId);
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
    const content = await readItemContent(ctx.fs, itemPath, vaultId);
    await ctx.index.upsertItem({ item: updated, content, sourceRef: null }, vaultId);
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
  const item = await readItemFile(ctx.fs, itemPath, vaultId);
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

  const content = await readItemContent(ctx.fs, itemPath, vaultId);
  await ctx.index.upsertItem({ item: updated, content, sourceRef: null }, vaultId);
  return updated;
}
