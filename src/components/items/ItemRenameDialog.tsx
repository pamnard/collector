import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export interface ItemRenameDialogProps {
  open: boolean;
  currentTitle: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (nextTitle: string) => void;
}

export function ItemRenameDialog({
  open,
  currentTitle,
  busy,
  onOpenChange,
  onConfirm,
}: ItemRenameDialogProps) {
  const [value, setValue] = useState(currentTitle);

  useEffect(() => {
    if (open) {
      setValue(currentTitle);
    }
  }, [open, currentTitle]);

  const confirm = () => {
    onConfirm(value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Переименовать</DialogTitle>
          <DialogDescription>
            Новое название для «{currentTitle.trim() || "Элемент"}».
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              confirm();
            }
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={busy || !value.trim()}
            onClick={confirm}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
