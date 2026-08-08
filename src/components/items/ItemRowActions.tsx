import { useState } from "react";
import type { ItemActionId } from "../../lib/item-action-catalog";
import { getCollectorService } from "../../services/collector-client";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ItemActionsMenu } from "./ItemActionsMenu";

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
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await getCollectorService().items.deleteItem(itemId);
      onUpdated?.();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAction = (id: ItemActionId) => {
    if (id === "delete") {
      setConfirmOpen(true);
    }
  };

  return (
    <div
      className="inline-flex items-center justify-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ItemActionsMenu
        triggerVariant="row"
        disabled={isDeleting}
        onAction={handleAction}
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
