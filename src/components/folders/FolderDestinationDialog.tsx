import { useEffect, useState, type ReactNode } from "react";
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
import { cn } from "../../lib/utils";

export type FolderDestinationRow = {
  path: string;
  label: string;
  disabled?: boolean;
};

export interface FolderDestinationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  destinations: readonly FolderDestinationRow[];
  listAriaLabel: string;
  confirmLabel?: string;
  /** Prefill selection when the dialog opens (`""` = vault root). */
  initialSelectedPath?: string;
  onConfirm: (path: string) => void;
}

export function FolderDestinationDialog({
  open,
  onOpenChange,
  title,
  description,
  destinations,
  listAriaLabel,
  confirmLabel = "Переместить",
  initialSelectedPath,
  onConfirm,
}: FolderDestinationDialogProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedPath(
        initialSelectedPath !== undefined ? initialSelectedPath : null,
      );
    }
  }, [open, initialSelectedPath]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedPath(null);
    }
    onOpenChange(next);
  };

  const handleConfirm = () => {
    if (selectedPath === null) {
      return;
    }
    const path = selectedPath;
    setSelectedPath(null);
    onOpenChange(false);
    onConfirm(path);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <FolderInput size={18} className="shrink-0" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          role="listbox"
          aria-label={listAriaLabel}
          className="custom-scrollbar max-h-[min(28rem,60vh)] overflow-y-auto rounded-lg border border-border"
        >
          {destinations.map((row) => {
            const disabled = row.disabled === true;
            const selected = selectedPath === row.path;
            return (
              <button
                key={row.label}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => setSelectedPath(row.path)}
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
            disabled={selectedPath === null}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
