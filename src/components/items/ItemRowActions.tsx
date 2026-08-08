import { useState } from "react";
import type { ItemActionId } from "../../lib/item-action-catalog";
import {
  ITEM_RENAME_BUSY_ID,
  ITEM_RENAME_ERROR_ID,
  renameItemTitle,
} from "../../lib/item-actions";
import { getCollectorService } from "../../services/collector-client";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { ItemRenameDialog } from "./ItemRenameDialog";

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
  useDismissAlertsOnUnmount([ITEM_RENAME_BUSY_ID, ITEM_RENAME_ERROR_ID]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await getCollectorService().items.deleteItem(itemId);
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

  const handleAction = (id: ItemActionId) => {
    if (id === "rename") {
      setRenameOpen(true);
      return;
    }
    if (id === "delete") {
      setConfirmOpen(true);
    }
  };

  const busy = isDeleting || isRenaming;

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
