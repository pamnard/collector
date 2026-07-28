import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { getCollectorClient } from "../../services/collector-client";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface ItemRowActionsProps {
  itemId: string;
  onUpdated?: () => void;
}

export function ItemRowActions({
  itemId,
  onUpdated,
}: ItemRowActionsProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm("Удалить элемент без возможности восстановления?")) {
      return;
    }

    setIsDeleting(true);
    try {
      await getCollectorClient().deleteItem(itemId);
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
            onClick={() => void handleDelete()}
          >
            Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
