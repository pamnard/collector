import type { FolderTreeNode } from "@collector/core";

export type FolderOption = { path: string; label: string };

export function flattenFolders(
  nodes: FolderTreeNode[],
  depth = 0,
): FolderOption[] {
  const out: FolderOption[] = [];
  for (const node of nodes) {
    out.push({
      path: node.path,
      label: `${"—".repeat(depth)}${depth ? " " : ""}${node.name}`,
    });
    if (node.children.length > 0) {
      out.push(...flattenFolders(node.children, depth + 1));
    }
  }
  return out;
}
