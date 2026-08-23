import { useState } from "react";
import { folderPathFromItemPath } from "@collector/shared";
import { useFolderTree } from "../../../hooks/useFolderTree";
import type { ItemActionId } from "../../../lib/item-action-catalog";
import {
  ITEM_LINT_BUSY_ID,
  ITEM_LINT_ERROR_ID,
  ITEM_MOVE_BUSY_ID,
  ITEM_MOVE_ERROR_ID,
  ITEM_RENAME_BUSY_ID,
  ITEM_RENAME_ERROR_ID,
  lintItemFile,
  moveItemToFolder,
  renameItemTitle,
} from "../../../lib/item-actions";
import { getCollectorService } from "../../../services/collector-client";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../../alerts/AlertBusProvider";
import { MoveItemDialog } from "../../folders/MoveItemDialog";
import { useShell } from "../../layout/AppLayout";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { ItemActionsMenu } from "../ItemActionsMenu";
import { ItemRenameDialog } from "../ItemRenameDialog";

interface ItemRowActionsProps {
  itemId: string;
  itemTitle: string;
  onUpdated?: () => void;
}

export function ItemRowActions({
  itemId,
  itemTitle,
  onUpdated,
}: ItemRowActionsProps) {
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([
    ITEM_RENAME_BUSY_ID,
    ITEM_RENAME_ERROR_ID,
    ITEM_MOVE_BUSY_ID,
    ITEM_MOVE_ERROR_ID,
    ITEM_LINT_BUSY_ID,
    ITEM_LINT_ERROR_ID,
  ]);
  const { vaultRevision, pruneItem } = useShell();
  const folders = useFolderTree(vaultRevision);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isLinting, setIsLinting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await getCollectorService().items.deleteItem(itemId);
      pruneItem(itemId);
      onUpdated?.();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmRename = async (nextTitle: string) => {
    setIsRenaming(true);
    const updated = await renameItemTitle(alerts, itemId, nextTitle);
    setIsRenaming(false);
    if (updated === undefined) {
      return;
    }
    setRenameOpen(false);
    onUpdated?.();
  };

  const handleConfirmMove = async (folderPath: string) => {
    setIsMoving(true);
    const updated = await moveItemToFolder(alerts, itemId, folderPath);
    setIsMoving(false);
    if (updated === undefined) {
      return;
    }
    setMoveOpen(false);
    onUpdated?.();
  };

  const handleLint = async () => {
    setIsLinting(true);
    const updated = await lintItemFile(alerts, itemId);
    setIsLinting(false);
    if (updated === undefined) {
      return;
    }
    onUpdated?.();
  };

  const handleAction = (id: ItemActionId) => {
    if (id === "move") {
      setMoveOpen(true);
      return;
    }
    if (id === "rename") {
      setRenameOpen(true);
      return;
    }
    if (id === "lint") {
      void handleLint();
      return;
    }
    if (id === "delete") {
      setConfirmOpen(true);
    }
  };

  const busy = isDeleting || isRenaming || isMoving || isLinting;
  const itemLabel = itemTitle.trim() || itemId;
  const currentFolderPath = folderPathFromItemPath(itemId);

  return (
    <div
      className="inline-flex items-center justify-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ItemActionsMenu
        triggerVariant="row"
        disabled={busy}
        onAction={handleAction}
      />

      <MoveItemDialog
        open={moveOpen}
        itemLabel={itemLabel}
        currentFolderPath={currentFolderPath}
        tree={folders}
        onOpenChange={setMoveOpen}
        onConfirm={(folderPath) => {
          void handleConfirmMove(folderPath);
        }}
      />

      <ItemRenameDialog
        open={renameOpen}
        currentTitle={itemTitle}
        busy={isRenaming}
        onOpenChange={setRenameOpen}
        onConfirm={(nextTitle) => {
          void handleConfirmRename(nextTitle);
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={itemTitle.trim() || "Элемент"}
        description="Удалить элемент без возможности восстановления?"
        busy={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
