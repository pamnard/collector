import type { FolderTreeNode } from "@collector/core";
import { CreateFolderDialog } from "../folders/CreateFolderDialog";
import { FolderLeafNameDialog } from "../folders/FolderLeafNameDialog";
import { MoveFolderDialog } from "../folders/MoveFolderDialog";
import { ConfirmDialog } from "../ui/confirm-dialog";
import type { NavFilter } from "../../types/ui";
import {
  defaultCreateFolderParentPath,
  folderDeleteDialogCopy,
  folderLeafNameDialogCopy,
  type SidebarFolderLeafDialog,
} from "./sidebar-folder-dialog-copy";

export type SidebarFolderDialogsProps = {
  activeFilter: NavFilter;
  tree: FolderTreeNode[];
  createFolderOpen: boolean;
  leafBusy: boolean;
  leafDialog: SidebarFolderLeafDialog | null;
  moveSourcePath: string | null;
  deleteSourcePath: string | null;
  isDeletingFolder: boolean;
  onCreateFolderOpenChange: (open: boolean) => void;
  onLeafDialogOpenChange: (open: boolean) => void;
  onMoveSourcePathChange: (path: string | null) => void;
  onDeleteSourcePathChange: (path: string | null) => void;
  onConfirmCreateChild: (parentPath: string, leafName: string) => void;
  onConfirmRename: (folderPath: string, newLeafName: string) => void;
  onConfirmMove: (folderPath: string, newParentPath: string) => void;
  onConfirmDelete: (folderPath: string) => void;
};

export function SidebarFolderDialogs({
  activeFilter,
  tree,
  createFolderOpen,
  leafBusy,
  leafDialog,
  moveSourcePath,
  deleteSourcePath,
  isDeletingFolder,
  onCreateFolderOpenChange,
  onLeafDialogOpenChange,
  onMoveSourcePathChange,
  onDeleteSourcePathChange,
  onConfirmCreateChild,
  onConfirmRename,
  onConfirmMove,
  onConfirmDelete,
}: SidebarFolderDialogsProps) {
  const defaultCreateParentPath = defaultCreateFolderParentPath(activeFilter);
  const leafCopy =
    leafDialog !== null ? folderLeafNameDialogCopy(leafDialog) : null;
  const deleteCopy =
    deleteSourcePath !== null
      ? folderDeleteDialogCopy(deleteSourcePath)
      : null;

  return (
    <>
      {createFolderOpen ? (
        <CreateFolderDialog
          open
          busy={leafBusy}
          tree={tree}
          initialParentPath={defaultCreateParentPath}
          onOpenChange={(open) => {
            if (!open && !leafBusy) {
              onCreateFolderOpenChange(false);
            }
          }}
          onConfirm={(parentPath, leafName) => {
            onConfirmCreateChild(parentPath, leafName);
          }}
        />
      ) : null}
      {moveSourcePath !== null ? (
        <MoveFolderDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              onMoveSourcePathChange(null);
            }
          }}
          folderPath={moveSourcePath}
          tree={tree}
          onConfirm={(newParentPath) => {
            const source = moveSourcePath;
            onMoveSourcePathChange(null);
            onConfirmMove(source, newParentPath);
          }}
        />
      ) : null}
      {leafDialog !== null && leafCopy !== null ? (
        <FolderLeafNameDialog
          open
          busy={leafBusy}
          title={leafCopy.title}
          description={leafCopy.description}
          confirmLabel={leafCopy.confirmLabel}
          initialValue={leafCopy.initialValue}
          placeholder={leafCopy.placeholder}
          onOpenChange={(open) => {
            if (!open && !leafBusy) {
              onLeafDialogOpenChange(false);
            }
          }}
          onConfirm={(leaf) => {
            if (leafDialog.kind === "rename") {
              onConfirmRename(leafDialog.path, leaf);
              return;
            }
            onConfirmCreateChild(leafDialog.path, leaf);
          }}
        />
      ) : null}
      {deleteSourcePath !== null && deleteCopy !== null ? (
        <ConfirmDialog
          open
          busy={isDeletingFolder}
          title={deleteCopy.title}
          description={deleteCopy.description}
          onOpenChange={(open) => {
            if (!open && !isDeletingFolder) {
              onDeleteSourcePathChange(null);
            }
          }}
          onConfirm={() => onConfirmDelete(deleteSourcePath)}
        />
      ) : null}
    </>
  );
}
