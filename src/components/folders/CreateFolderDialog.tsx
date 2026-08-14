import { useEffect, useMemo, useState } from "react";
import type { FolderTreeNode } from "@collector/core";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listFolderParentChoices } from "../../lib/folder-actions";
import { cn } from "../../lib/utils";

export interface CreateFolderDialogProps {
  open: boolean;
  busy: boolean;
  tree: FolderTreeNode[];
  /** Prefill parent (`""` = vault root). */
  initialParentPath: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (parentPath: string, leafName: string) => void;
}

export function CreateFolderDialog({
  open,
  busy,
  tree,
  initialParentPath,
  onOpenChange,
  onConfirm,
}: CreateFolderDialogProps) {
  const destinations = useMemo(
    () =>
      listFolderParentChoices(tree).map((row) => ({
        path: row.parentPath,
        label: row.label,
      })),
    [tree],
  );

  const [parentPath, setParentPath] = useState<string | null>(null);
  const [leafName, setLeafName] = useState("");

  useEffect(() => {
    if (open) {
      setParentPath(initialParentPath);
      setLeafName("");
    }
  }, [open, initialParentPath]);

  const handleOpenChange = (next: boolean) => {
    if (busy) {
      return;
    }
    if (!next) {
      setParentPath(null);
      setLeafName("");
    }
    onOpenChange(next);
  };

  const canSubmit =
    parentPath !== null && leafName.trim().length > 0 && !busy;

  const submit = () => {
    if (parentPath === null || !leafName.trim()) {
      return;
    }
    onConfirm(parentPath, leafName);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <FolderPlus size={18} className="shrink-0" />
            Новая папка
          </DialogTitle>
          <DialogDescription>
            Родительская папка (корень хранилища — «/») и имя новой папки.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div
            role="listbox"
            aria-label="Родительская папка"
            className="custom-scrollbar max-h-[min(20rem,45vh)] overflow-y-auto rounded-lg border border-border"
          >
            {destinations.map((row) => {
              const selected = parentPath === row.path;
              return (
                <button
                  key={row.label}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={busy}
                  onClick={() => setParentPath(row.path)}
                  className={cn(
                    "flex w-full items-center px-3 py-2.5 text-left text-sm transition-colors",
                    busy
                      ? "cursor-not-allowed text-muted-foreground opacity-50"
                      : "hover:bg-accent hover:text-accent-foreground",
                    selected && !busy
                      ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-600/10 dark:text-indigo-400"
                      : null,
                  )}
                >
                  <span className="break-all font-mono">{row.label}</span>
                </button>
              );
            })}
          </div>
          <Input
            value={leafName}
            onChange={(event) => setLeafName(event.target.value)}
            disabled={busy}
            autoFocus
            placeholder="Имя папки"
            aria-label="Имя папки"
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            Отмена
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={submit}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
