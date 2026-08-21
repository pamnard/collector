import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { getCollectorService } from "../services/collector-client";
import { patchFolderTreeItemCounts } from "../lib/folder-tree-count-patch";
import { subscribeFolderTreeLive } from "../lib/folder-tree-live";

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

  useEffect(() => {
    return subscribeFolderTreeLive({
      onDeltas(deltas) {
        setTree((current) => patchFolderTreeItemCounts(current, deltas));
      },
      onRecount() {
        void getCollectorService()
          .folders.listFolderTree()
          .then((next) => {
            setTree(next);
          });
      },
    });
  }, []);

  return tree;
}
