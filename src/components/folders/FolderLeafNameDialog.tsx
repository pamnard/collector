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

export interface FolderLeafNameDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  initialValue?: string;
  placeholder?: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (leafName: string) => void;
}

export function FolderLeafNameDialog({
  open,
  title,
  description,
  confirmLabel,
  initialValue = "",
  placeholder,
  busy,
  onOpenChange,
  onConfirm,
}: FolderLeafNameDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [open, initialValue]);

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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
          autoFocus
          placeholder={placeholder}
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
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
