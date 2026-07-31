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

interface TagRenameDialogProps {
  open: boolean;
  tagName: string;
  renameValue: string;
  isRenaming: boolean;
  onRenameValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TagRenameDialog({
  open,
  tagName,
  renameValue,
  isRenaming,
  onRenameValueChange,
  onOpenChange,
  onConfirm,
  onCancel,
}: TagRenameDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isRenaming) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent showCloseButton={!isRenaming}>
        <DialogHeader>
          <DialogTitle>Переименовать тег</DialogTitle>
          <DialogDescription>Новое имя для «{tagName}».</DialogDescription>
        </DialogHeader>
        <Input
          value={renameValue}
          onChange={(event) => onRenameValueChange(event.target.value)}
          disabled={isRenaming}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm();
            }
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isRenaming}
            onClick={onCancel}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={isRenaming || !renameValue.trim()}
            onClick={onConfirm}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
