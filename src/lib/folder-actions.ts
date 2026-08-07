import type { FolderTreeNode } from "@collector/core";
import { renameFolderPath } from "@collector/core";
import { compareFolderNamesForDisplay } from "@collector/shared";
import { isFolderFilter } from "../types/ui";
import type { NavFilter } from "../types/ui";
import { getCollectorService } from "../services/collector-client";

export function folderParentPath(folderPath: string): string {
  const slash = folderPath.lastIndexOf("/");
  return slash === -1 ? "" : folderPath.slice(0, slash);
}

/** `A/B` under `C` → `C/B`; under root → `B`. */
export function buildMovedFolderPath(
  oldPath: string,
  newParentPath: string,
): string {
  const slash = oldPath.lastIndexOf("/");
  const leaf = slash === -1 ? oldPath : oldPath.slice(slash + 1);
  if (!leaf) {
    throw new Error("Cannot move the vault root");
  }
  return newParentPath ? `${newParentPath}/${leaf}` : leaf;
}

/** Parents that must not be choosable when moving `folderPath`. */
export function isIllegalMoveParent(
  folderPath: string,
  parentPath: string,
): boolean {
  return (
    parentPath === folderPath ||
    parentPath.startsWith(`${folderPath}/`) ||
    parentPath === folderParentPath(folderPath)
  );
}

function folderPathSortKey(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(0, slash);
}

export function sortFolderPathsFlat(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const root = compareFolderNamesForDisplay(
      folderPathSortKey(a),
      folderPathSortKey(b),
    );
    if (root !== 0) {
      return root;
    }
    return a.localeCompare(b);
  });
}

/** Flat vault-relative folder paths (shared with FolderPicker ordering). */
export function collectFolderPathsFlat(tree: FolderTreeNode[]): string[] {
  const collected: string[] = [];
  const walk = (nodes: FolderTreeNode[]) => {
    for (const node of nodes) {
      collected.push(node.path);
      walk(node.children);
    }
  };
  walk(tree);
  return sortFolderPathsFlat(collected);
}

export function rewriteFolderNavFilterAfterMove(
  filter: NavFilter,
  oldPath: string,
  newPath: string,
): NavFilter | null {
  if (!isFolderFilter(filter)) {
    return null;
  }
  const nextPath = renameFolderPath(filter.folderPath, oldPath, newPath);
  if (nextPath === filter.folderPath) {
    return null;
  }
  return { type: "folder", folderPath: nextPath };
}

export async function moveFolderTo(
  oldPath: string,
  newParentPath: string,
): Promise<string> {
  if (isIllegalMoveParent(oldPath, newParentPath)) {
    throw new Error(
      `Cannot move folder into itself, a descendant, or its current parent: ${oldPath}`,
    );
  }
  const newPath = buildMovedFolderPath(oldPath, newParentPath);
  return getCollectorService().folders.renameFolder(oldPath, newPath);
}
