import { Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteItem } from "../../services/collector-service";
import { ItemFlagActions } from "./ItemFlagActions";

interface ItemRowActionsProps {
  itemId: string;
  isFavorite: boolean;
  isArchived: boolean;
  onUpdated?: () => void;
}

export function ItemRowActions({
  itemId,
  isFavorite,
  isArchived,
  onUpdated,
}: ItemRowActionsProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm("Удалить элемент без возможности восстановления?")) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteItem(itemId);
      onUpdated?.();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="inline-flex items-center gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ItemFlagActions
        itemId={itemId}
        isFavorite={isFavorite}
        isArchived={isArchived}
        onUpdated={onUpdated}
        compact
      />
      <button
        type="button"
        aria-label="Удалить"
        disabled={isDeleting}
        onClick={() => void handleDelete()}
        className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
