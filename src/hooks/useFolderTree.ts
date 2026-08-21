import { useEffect, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { getCollectorService } from "../services/collector-client";
import { useAlerts } from "../components/alerts/AlertBusProvider";
import { errorMessage } from "../components/alerts/alert-store";
import { patchFolderTreeItemCounts } from "../lib/folder-tree-count-patch";
import { subscribeFolderTreeLive } from "../lib/folder-tree-live";

const FOLDER_TREE_RECOUNT_ERROR_ID = "folder-tree-recount-error";

export function useFolderTree(vaultRevision: number): FolderTreeNode[] {
  const [tree, setTree] = useState<FolderTreeNode[]>([]);
  const alerts = useAlerts();

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
            alerts.dismiss(FOLDER_TREE_RECOUNT_ERROR_ID);
            setTree(next);
          })
          .catch((error: unknown) => {
            alerts.upsert(FOLDER_TREE_RECOUNT_ERROR_ID, {
              tone: "danger",
              message: errorMessage(error),
            });
          });
      },
    });
  }, [alerts]);

  return tree;
}
