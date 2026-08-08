import { useMemo, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isIllegalMoveParent,
  listFolderParentChoices,
} from "../../lib/folder-actions";
import { cn } from "../../lib/utils";

export interface MoveFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPath: string;
  tree: FolderTreeNode[];
  onConfirm: (newParentPath: string) => void;
}

export function MoveFolderDialog({
  open,
  onOpenChange,
  folderPath,
  tree,
  onConfirm,
}: MoveFolderDialogProps) {
  const [selectedParent, setSelectedParent] = useState<string | null>(null);

  const destinations = useMemo(() => listFolderParentChoices(tree), [tree]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedParent(null);
    }
    onOpenChange(next);
  };

  const handleConfirm = () => {
    if (selectedParent === null) {
      return;
    }
    const parent = selectedParent;
    setSelectedParent(null);
    onOpenChange(false);
    onConfirm(parent);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <FolderInput size={18} className="shrink-0" />
            Переместить папку
          </DialogTitle>
          <DialogDescription>
            Выберите новую родительскую папку для{" "}
            <span className="break-all font-medium text-foreground">
              {folderPath}
            </span>
            . Корень хранилища — «/».
          </DialogDescription>
        </DialogHeader>
        <div
          role="listbox"
          aria-label="Папка назначения"
          className="custom-scrollbar max-h-[min(28rem,60vh)] overflow-y-auto rounded-lg border border-border"
        >
          {destinations.map((row) => {
            const disabled = isIllegalMoveParent(folderPath, row.parentPath);
            const selected = selectedParent === row.parentPath;
            return (
              <button
                key={row.label}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => setSelectedParent(row.parentPath)}
                className={cn(
                  "flex w-full items-center px-3 py-2.5 text-left text-sm transition-colors",
                  disabled
                    ? "cursor-not-allowed text-muted-foreground opacity-50"
                    : "hover:bg-accent hover:text-accent-foreground",
                  selected && !disabled
                    ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-600/10 dark:text-indigo-400"
                    : null,
                )}
              >
                <span className="break-all font-mono">{row.label}</span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={selectedParent === null}
            onClick={handleConfirm}
          >
            Переместить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
