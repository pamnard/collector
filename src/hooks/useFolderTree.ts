import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { getCollectorClient } from "../services/collector-client";

export function useFolderTree(vaultRevision: number): FolderTreeNode[] {
  const [tree, setTree] = useState<FolderTreeNode[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    getCollectorClient().subscribeFolderTree(
      setTree,
      undefined,
      controller.signal,
    );

    return () => {
      controller.abort();
    };
  }, [vaultRevision]);

  return tree;
}
