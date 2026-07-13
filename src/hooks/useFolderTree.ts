import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { subscribeFolderTree } from "../services/collector-service";

export function useFolderTree(vaultRevision: number): FolderTreeNode[] {
  const [tree, setTree] = useState<FolderTreeNode[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    subscribeFolderTree(setTree, undefined, controller.signal);

    return () => {
      controller.abort();
    };
  }, [vaultRevision]);

  return tree;
}
