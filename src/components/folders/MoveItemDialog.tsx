import { useMemo } from "react";
import type { FolderTreeNode } from "@collector/core";
import {
  isCurrentItemFolderDestination,
  listItemFolderDestinations,
} from "../../lib/folder-actions";
import { FolderDestinationDialog } from "./FolderDestinationDialog";

export interface MoveItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemLabel: string;
  currentFolderPath: string;
  tree: FolderTreeNode[];
  onConfirm: (folderPath: string) => void;
}

export function MoveItemDialog({
  open,
  onOpenChange,
  itemLabel,
  currentFolderPath,
  tree,
  onConfirm,
}: MoveItemDialogProps) {
  const destinations = useMemo(
    () =>
      listItemFolderDestinations(tree).map((row) => ({
        path: row.path,
        label: row.label,
        disabled: isCurrentItemFolderDestination(currentFolderPath, row.path),
      })),
    [currentFolderPath, tree],
  );

  return (
    <FolderDestinationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Переместить файл"
      description={
        <>
          Выберите папку для{" "}
          <span className="break-all font-medium text-foreground">
            {itemLabel}
          </span>
          .
        </>
      }
      destinations={destinations}
      listAriaLabel="Папка назначения"
      onConfirm={onConfirm}
    />
  );
}
