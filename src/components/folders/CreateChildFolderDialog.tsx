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
import { folderLeafName } from "../../lib/folder-actions";

export interface CreateChildFolderDialogProps {
  open: boolean;
  parentPath: string;
  leafValue: string;
  isCreating: boolean;
  onLeafValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CreateChildFolderDialog({
  open,
  parentPath,
  leafValue,
  isCreating,
  onLeafValueChange,
  onOpenChange,
  onConfirm,
  onCancel,
}: CreateChildFolderDialogProps) {
  const parentLeaf = folderLeafName(parentPath);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isCreating) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent showCloseButton={!isCreating}>
        <DialogHeader>
          <DialogTitle>Новая папка</DialogTitle>
          <DialogDescription>
            Дочерняя папка внутри «{parentLeaf}».
          </DialogDescription>
        </DialogHeader>
        <Input
          value={leafValue}
          onChange={(event) => onLeafValueChange(event.target.value)}
          disabled={isCreating}
          autoFocus
          placeholder="Имя папки"
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
            disabled={isCreating}
            onClick={onCancel}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={isCreating || !leafValue.trim()}
            onClick={onConfirm}
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
