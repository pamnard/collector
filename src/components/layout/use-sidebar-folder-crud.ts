import { useState } from "react";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import type { FolderActionId } from "../../lib/folder-action-catalog";
import type { NavFilter } from "../../types/ui";
import { SIDEBAR_FOLDER_ALERT_IDS } from "./sidebar-folder-alert-ids";
import type { SidebarFolderLeafDialog } from "./sidebar-folder-dialog-copy";
import {
  confirmCreateChildFolder,
  confirmDeleteFolder,
  confirmMoveFolder,
  confirmRenameFolder,
  copyFolderPathToClipboard,
} from "./sidebar-folder-crud-ops";

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
    if (id === "copy-path") {
      void copyFolderPathToClipboard(alerts, path);
      return;
    }
    if (id === "delete") {
      setDeleteSourcePath(path);
    }
  };

  const handleConfirmMove = async (
    folderPath: string,
    newParentPath: string,
  ) => {
    await confirmMoveFolder({
      alerts,
      activeFilter,
      onSelect,
      folderPath,
      newParentPath,
    });
  };

  const handleConfirmRename = async (
    folderPath: string,
    newLeafName: string,
  ) => {
    setLeafBusy(true);
    const newPath = await confirmRenameFolder({
      alerts,
      activeFilter,
      onSelect,
      folderPath,
      newLeafName,
    });
    setLeafBusy(false);
    if (newPath === undefined) {
      return;
    }
    setLeafDialog(null);
  };

  const handleConfirmCreateChild = async (
    parentPath: string,
    leafName: string,
  ) => {
    setLeafBusy(true);
    const newPath = await confirmCreateChildFolder({
      alerts,
      onSelect,
      parentPath,
      leafName,
    });
    setLeafBusy(false);
    if (newPath === undefined) {
      return;
    }
    setLeafDialog(null);
    setCreateFolderOpen(false);
  };

  const handleConfirmDelete = async (folderPath: string) => {
    setIsDeletingFolder(true);
    try {
      await confirmDeleteFolder({
        alerts,
        activeFilter,
        onSelect,
        folderPath,
      });
      setDeleteSourcePath(null);
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
