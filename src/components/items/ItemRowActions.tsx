import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { getCollectorService } from "../../services/collector-client";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

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

  return (
    <div
      className="inline-flex items-center justify-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Действия"
              disabled={isDeleting}
              className="text-neutral-500 dark:text-neutral-400"
            />
          }
        >
          <MoreHorizontal size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem
            variant="destructive"
            disabled={isDeleting}
            onClick={() => setConfirmOpen(true)}
          >
            Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
