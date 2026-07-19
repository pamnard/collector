import type { ItemFile } from "@collector/shared";
import {
  folderPathFromItemPath,
  isValidFolderPath,
  normalizeFolderPath,
} from "@collector/shared";
import type { VaultContext } from "../adapters/types.js";
import { nowIso } from "../util/ids.js";
import { buildFolderTree, renameFolderPath, type FolderTreeNode } from "./folder-tree.js";
import {
  readItemContent,
  readItemFile,
  readItemSourceRef,
  writeItemFile,
} from "./item-io.js";
import {
  basename,
  itemMarkdownPath,
  itemMediaRoot,
  joinSegments,
  normalizeRelativePath,
} from "./paths.js";
import { listFolderRelativePaths } from "./scan.js";

function assertFolderPath(path: string): string {
  const normalized = normalizeFolderPath(path);
  if (!isValidFolderPath(normalized)) {
    throw new Error(`Invalid folder path: ${path}`);
  }
  return normalized;
}

export function buildFolderTreeFromSources(
  diskFolderPaths: string[],
  countRows: Array<{ folder_path: string; item_count: number }>,
): FolderTreeNode[] {
  const counts = new Map(countRows.map((row) => [row.folder_path, row.item_count]));
  const allPaths = [...diskFolderPaths, ...countRows.map((row) => row.folder_path)];
  return buildFolderTree(allPaths, counts);
}

/** Real FS folder paths under the vault root (collections are directories, #134). */
export async function readVaultFolderPaths(
  ctx: VaultContext,
  vaultPath: string,
): Promise<string[]> {
  return listFolderRelativePaths(ctx.fs, vaultPath);
}

/** SQLite counts only (no disk scan) — misses folders that currently hold zero items. */
export async function listFolderTreeFromIndex(
  ctx: VaultContext,
  _vaultPath: string,
  vaultId: string,
): Promise<FolderTreeNode[]> {
  const countRows = await ctx.index.listFolderItemCounts(vaultId);
  return buildFolderTreeFromSources([], countRows);
}

/** Authoritative: union of real on-disk folders + SQLite item counts. */
export async function reconcileFolderTreeFromDisk(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
): Promise<FolderTreeNode[]> {
  const diskFolders = await listFolderRelativePaths(ctx.fs, vaultPath);
  const countRows = await ctx.index.listFolderItemCounts(vaultId);
  return buildFolderTreeFromSources(diskFolders, countRows);
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
  if (!normalized) {
    throw new Error("Folder path must be non-empty");
  }
  await ctx.fs.mkdir(joinSegments(vaultPath, normalized));
  await ctx.fs.touch(vaultPath);
  return normalized;
}

/**
 * Rename a real FS folder. Item ids embed their path, so every item under
 * the old prefix gets a new id; the index rewrites those PKs in SQL without
 * re-reading markdown from disk.
 */
export async function renameFolder(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  oldPath: string,
  newPath: string,
): Promise<string> {
  const from = assertFolderPath(oldPath);
  const to = assertFolderPath(newPath);
  if (!from) {
    throw new Error("Cannot rename the vault root");
  }
  if (from === to) {
    return to;
  }

  const fromAbs = joinSegments(vaultPath, from);
  const toAbs = joinSegments(vaultPath, to);
  if (!(await ctx.fs.exists(fromAbs))) {
    throw new Error(`Folder not found: ${from}`);
  }
  if (await ctx.fs.exists(toAbs)) {
    throw new Error(`Folder already exists: ${to}`);
  }

  const itemIds = await ctx.index.listItemIdsByFolderPrefix(vaultId, from);

  await ctx.fs.rename(fromAbs, toAbs);
  await ctx.fs.touch(vaultPath);

  const mappings = itemIds
    .map((oldId) => {
      const newId = renameFolderPath(oldId, from, to);
      return {
        oldId,
        newId,
        folderPath: folderPathFromItemPath(newId),
      };
    })
    .filter((mapping) => mapping.newId !== mapping.oldId);

  await ctx.index.rewriteItemIds(mappings);

  return to;
}

/** Empty-dir only — real collections cannot be deleted while they still hold entries. */
export async function deleteFolder(
  ctx: VaultContext,
  vaultPath: string,
  _vaultId: string,
  path: string,
): Promise<void> {
  const normalized = assertFolderPath(path);
  if (!normalized) {
    throw new Error("Cannot delete the vault root");
  }

  const abs = joinSegments(vaultPath, normalized);
  if (!(await ctx.fs.exists(abs))) {
    throw new Error(`Folder not found: ${normalized}`);
  }

  const entries = await ctx.fs.readDir(abs);
  if (entries.length > 0) {
    throw new Error(`Folder is not empty: ${normalized}`);
  }

  await ctx.fs.remove(abs, { recursive: true });
  await ctx.fs.touch(vaultPath);
}

/** Rename the item's `.md` file (+ sibling `.media/`) into the target folder. */
export async function moveItemToFolder(
  ctx: VaultContext,
  vaultPath: string,
  vaultId: string,
  itemId: string,
  folderPath: string,
): Promise<ItemFile> {
  const normalized = assertFolderPath(folderPath);
  const id = normalizeRelativePath(itemId);
  const name = basename(id);
  const newId = normalized ? `${normalized}/${name}` : name;

  if (newId === id) {
    return readItemFile(ctx.fs, vaultPath, id, vaultId);
  }

  const fromPath = itemMarkdownPath(vaultPath, id);
  const toPath = itemMarkdownPath(vaultPath, newId);
  if (!(await ctx.fs.exists(fromPath))) {
    throw new Error(`Item not found: ${id}`);
  }
  if (await ctx.fs.exists(toPath)) {
    throw new Error(`Item already exists at destination: ${newId}`);
  }

  if (normalized) {
    await ctx.fs.mkdir(joinSegments(vaultPath, normalized));
  }
  await ctx.fs.rename(fromPath, toPath);

  const fromMediaRoot = itemMediaRoot(vaultPath, id);
  if (await ctx.fs.exists(fromMediaRoot)) {
    await ctx.fs.rename(fromMediaRoot, itemMediaRoot(vaultPath, newId));
  }

  await ctx.fs.touch(vaultPath);
  await ctx.index.deleteItem(id);

  const moved = await readItemFile(ctx.fs, vaultPath, newId, vaultId);
  const updated: ItemFile = { ...moved, updated_at: nowIso() };
  await writeItemFile(ctx.fs, vaultPath, updated);

  const content = await readItemContent(ctx.fs, vaultPath, newId);
  const sourceRef = await readItemSourceRef(ctx.fs, vaultPath, newId);
  const fileStat = await ctx.fs.stat(toPath);
  await ctx.index.upsertItem(
    { item: updated, content, sourceRef, fileMtimeMs: fileStat.mtimeMs },
    vaultId,
  );
  return updated;
}
