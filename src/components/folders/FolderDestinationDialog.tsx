import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, FolderInput } from "lucide-react";
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

export type FolderSuggestionRow = {
  path: string;
  label: string;
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
  /** Optional suggestions shown below the full destination list. */
  suggestions?: readonly FolderSuggestionRow[];
  onConfirm: (path: string) => void;
}

function destinationRowClassName(input: {
  disabled: boolean;
  selected: boolean;
}): string {
  return cn(
    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors",
    input.disabled
      ? "cursor-not-allowed text-muted-foreground opacity-50"
      : "hover:bg-accent hover:text-accent-foreground",
    input.selected && !input.disabled
      ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-600/10 dark:text-indigo-400"
      : null,
  );
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
  suggestions,
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

  const destinationByPath = new Map(
    destinations.map((row) => [row.path, row] as const),
  );
  const visibleSuggestions = (suggestions ?? []).filter((row) => {
    const dest = destinationByPath.get(row.path);
    return dest !== undefined && dest.disabled !== true;
  });

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
                className={destinationRowClassName({ disabled, selected })}
              >
                <span className="min-w-0 flex-1 break-all font-mono">
                  {row.label}
                </span>
              </button>
            );
          })}
        </div>
        {visibleSuggestions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Возможно сюда</p>
            <div
              role="group"
              aria-label="Предлагаемые папки"
              className="overflow-hidden rounded-lg border border-border"
            >
              {visibleSuggestions.map((row) => {
                const selected = selectedPath === row.path;
                return (
                  <button
                    key={row.path}
                    type="button"
                    onClick={() => setSelectedPath(row.path)}
                    className={destinationRowClassName({
                      disabled: false,
                      selected,
                    })}
                  >
                    <span className="min-w-0 flex-1 break-all font-mono">
                      {row.label}
                    </span>
                    <ChevronRight
                      size={16}
                      className="shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
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
