/**
 * Immutable hierarchical item_count patches for sidebar folder trees (#756).
 */

import type { FolderTreeNode } from "@collector/core";

function patchNode(
  node: FolderTreeNode,
  deltas: Map<string, number>,
): FolderTreeNode {
  const delta = deltas.get(node.path) ?? 0;
  const children = node.children.map((child) => patchNode(child, deltas));
  const childrenChanged = children.some(
    (child, index) => child !== node.children[index],
  );
  if (delta === 0 && !childrenChanged) {
    return node;
  }
  return {
    ...node,
    item_count: node.item_count + delta,
    children: childrenChanged ? children : node.children,
  };
}

/** Apply path→delta map to a forest; shares unchanged node identities. */
export function patchFolderTreeItemCounts(
  tree: FolderTreeNode[],
  deltas: Map<string, number>,
): FolderTreeNode[] {
  if (deltas.size === 0) {
    return tree;
  }
  let changed = false;
  const next = tree.map((node) => {
    const patched = patchNode(node, deltas);
    if (patched !== node) {
      changed = true;
    }
    return patched;
  });
  return changed ? next : tree;
}
