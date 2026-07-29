import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { getCollectorService } from "../services/collector-client";

export function useFolderTree(vaultRevision: number): FolderTreeNode[] {
  const [tree, setTree] = useState<FolderTreeNode[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    getCollectorService().folders.subscribeFolderTree(
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
