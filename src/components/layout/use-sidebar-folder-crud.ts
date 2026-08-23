import { useState } from "react";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { runWithBusyAlert } from "../alerts/run-with-busy-alert";
import type { FolderActionId } from "../../lib/folder-action-catalog";
import {
  clearFolderNavFilterAfterDelete,
  createChildFolder,
  deleteFolderAt,
  moveFolderTo,
  renameFolderLeaf,
  rewriteFolderNavFilterAfterMove,
} from "../../lib/folder-actions";
import type { NavFilter } from "../../types/ui";
import {
  FOLDER_CREATE_BUSY_ID,
  FOLDER_CREATE_ERROR_ID,
  FOLDER_DELETE_BUSY_ID,
  FOLDER_DELETE_ERROR_ID,
  FOLDER_MOVE_BUSY_ID,
  FOLDER_MOVE_ERROR_ID,
  FOLDER_RENAME_BUSY_ID,
  FOLDER_RENAME_ERROR_ID,
  SIDEBAR_FOLDER_ALERT_IDS,
} from "./sidebar-folder-alert-ids";
import type { SidebarFolderLeafDialog } from "./sidebar-folder-dialog-copy";

export type UseSidebarFolderCrudInput = {
  activeFilter: NavFilter;
  onSelect: (filter: NavFilter) => void;
  openCreate: (folderPath?: string) => void;
};

export type UseSidebarFolderCrudResult = {
  moveSourcePath: string | null;
  setMoveSourcePath: (path: string | null) => void;
  createFolderOpen: boolean;
  setCreateFolderOpen: (open: boolean) => void;
  leafDialog: SidebarFolderLeafDialog | null;
  setLeafDialog: (dialog: SidebarFolderLeafDialog | null) => void;
  leafBusy: boolean;
  deleteSourcePath: string | null;
  setDeleteSourcePath: (path: string | null) => void;
  isDeletingFolder: boolean;
  handleFolderAction: (id: FolderActionId, path: string) => void;
  handleConfirmMove: (
    folderPath: string,
    newParentPath: string,
  ) => Promise<void>;
  handleConfirmRename: (
    folderPath: string,
    newLeafName: string,
  ) => Promise<void>;
  handleConfirmCreateChild: (
    parentPath: string,
    leafName: string,
  ) => Promise<void>;
  handleConfirmDelete: (folderPath: string) => Promise<void>;
};

export function useSidebarFolderCrud({
  activeFilter,
  onSelect,
  openCreate,
}: UseSidebarFolderCrudInput): UseSidebarFolderCrudResult {
  const alerts = useAlerts();
  const [moveSourcePath, setMoveSourcePath] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [leafDialog, setLeafDialog] = useState<SidebarFolderLeafDialog | null>(
    null,
  );
  const [leafBusy, setLeafBusy] = useState(false);
  const [deleteSourcePath, setDeleteSourcePath] = useState<string | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);

  useDismissAlertsOnUnmount(SIDEBAR_FOLDER_ALERT_IDS);

  const handleFolderAction = (id: FolderActionId, path: string) => {
    if (id === "new-note") {
      openCreate(path);
      return;
    }
    if (id === "new-folder") {
      setLeafDialog({ kind: "create", path });
      return;
    }
    if (id === "rename") {
      setLeafDialog({ kind: "rename", path });
      return;
    }
    if (id === "move") {
      setMoveSourcePath(path);
      return;
    }
    if (id === "delete") {
      setDeleteSourcePath(path);
    }
  };

  const applyNavRewrite = (next: NavFilter | null) => {
    if (next) {
      onSelect(next);
    }
  };

  const handleConfirmMove = async (
    folderPath: string,
    newParentPath: string,
  ) => {
    const newPath = await runWithBusyAlert(alerts, {
      busyId: FOLDER_MOVE_BUSY_ID,
      errorId: FOLDER_MOVE_ERROR_ID,
      label: "Перемещаю папку и всё содержимое…",
      run: () => moveFolderTo(folderPath, newParentPath),
    });
    if (newPath === undefined) {
      return;
    }
    applyNavRewrite(
      rewriteFolderNavFilterAfterMove(activeFilter, folderPath, newPath),
    );
  };

  const handleConfirmRename = async (
    folderPath: string,
    newLeafName: string,
  ) => {
    setLeafBusy(true);
    const newPath = await runWithBusyAlert(alerts, {
      busyId: FOLDER_RENAME_BUSY_ID,
      errorId: FOLDER_RENAME_ERROR_ID,
      label: "Переименовываю папку и всё содержимое…",
      run: () => renameFolderLeaf(folderPath, newLeafName),
    });
    setLeafBusy(false);
    if (newPath === undefined) {
      return;
    }
    setLeafDialog(null);
    applyNavRewrite(
      rewriteFolderNavFilterAfterMove(activeFilter, folderPath, newPath),
    );
  };

  const handleConfirmCreateChild = async (
    parentPath: string,
    leafName: string,
  ) => {
    setLeafBusy(true);
    const newPath = await runWithBusyAlert(alerts, {
      busyId: FOLDER_CREATE_BUSY_ID,
      errorId: FOLDER_CREATE_ERROR_ID,
      label: "Создаю папку…",
      run: () => createChildFolder(parentPath, leafName),
    });
    setLeafBusy(false);
    if (newPath === undefined) {
      return;
    }
    setLeafDialog(null);
    setCreateFolderOpen(false);
    onSelect({ type: "folder", folderPath: newPath });
  };

  const handleConfirmDelete = async (folderPath: string) => {
    setIsDeletingFolder(true);
    try {
      await runWithBusyAlert(alerts, {
        busyId: FOLDER_DELETE_BUSY_ID,
        errorId: FOLDER_DELETE_ERROR_ID,
        label: "Удаляю папку и всё содержимое…",
        rethrow: true,
        run: () => deleteFolderAt(folderPath),
      });
      setDeleteSourcePath(null);
      applyNavRewrite(clearFolderNavFilterAfterDelete(activeFilter, folderPath));
    } finally {
      setIsDeletingFolder(false);
    }
  };

  return {
    moveSourcePath,
    setMoveSourcePath,
    createFolderOpen,
    setCreateFolderOpen,
    leafDialog,
    setLeafDialog,
    leafBusy,
    deleteSourcePath,
    setDeleteSourcePath,
    isDeletingFolder,
    handleFolderAction,
    handleConfirmMove,
    handleConfirmRename,
    handleConfirmCreateChild,
    handleConfirmDelete,
  };
}
