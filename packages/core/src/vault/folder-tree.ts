import { normalizeFolderPath } from "@collector/shared";

export interface FolderTreeNode {
  name: string;
  path: string;
  item_count: number;
  children: FolderTreeNode[];
}

export function collectFolderPaths(paths: string[]): string[] {
  const collected = new Set<string>();

  for (const rawPath of paths) {
    const normalized = normalizeFolderPath(rawPath);
    if (!normalized) {
      continue;
    }

    collected.add(normalized);
    const parts = normalized.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      collected.add(parts.slice(0, index).join("/"));
    }
  }

  return [...collected].sort((a, b) => a.localeCompare(b));
}

export function folderMatchesPrefix(
  itemPath: string,
  folderPath: string,
): boolean {
  if (!folderPath) {
    return !itemPath;
  }
  return itemPath === folderPath || itemPath.startsWith(`${folderPath}/`);
}

export function buildFolderTree(
  paths: string[],
  counts: Map<string, number>,
): FolderTreeNode[] {
  const roots: FolderTreeNode[] = [];
  const nodes = new Map<string, FolderTreeNode>();

  for (const path of collectFolderPaths(paths)) {
    const parts = path.split("/");
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (nodes.has(currentPath)) {
        continue;
      }

      const node: FolderTreeNode = {
        name: part,
        path: currentPath,
        item_count: counts.get(currentPath) ?? 0,
        children: [],
      };
      nodes.set(currentPath, node);

      const parentPath = currentPath.includes("/")
        ? currentPath.slice(0, currentPath.lastIndexOf("/"))
        : "";
      if (parentPath) {
        nodes.get(parentPath)?.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  const rollupCounts = (node: FolderTreeNode): number => {
    let total = counts.get(node.path) ?? 0;
    for (const child of node.children) {
      total += rollupCounts(child);
    }
    node.item_count = total;
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    return total;
  };

  for (const root of roots) {
    rollupCounts(root);
  }

  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

export function renameFolderPath(
  itemPath: string,
  oldPath: string,
  newPath: string,
): string {
  if (!oldPath) {
    return itemPath;
  }
  if (itemPath === oldPath) {
    return newPath;
  }
  if (itemPath.startsWith(`${oldPath}/`)) {
    return `${newPath}${itemPath.slice(oldPath.length)}`;
  }
  return itemPath;
}
