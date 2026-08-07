import { useEffect, useState } from "react";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { errorMessage } from "../alerts/alert-store";
import { EMPTY_ITEM_FORM, type ItemFormValues } from "../../types/item";
import { ItemForm } from "./ItemForm";
import { getCollectorService } from "../../services/collector-client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const CREATE_ITEM_ERROR_ID = "create-item-error";

interface CreateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (itemId: string) => void;
}

export function CreateItemDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateItemDialogProps) {
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([CREATE_ITEM_ERROR_ID]);
  const [values, setValues] = useState<ItemFormValues>(EMPTY_ITEM_FORM);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(EMPTY_ITEM_FORM);
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.title.trim()) {
      return;
    }

    setIsSaving(true);
    alerts.dismiss(CREATE_ITEM_ERROR_ID);

    try {
      const item = await getCollectorService().items.createItem({
        title: values.title.trim(),
        description: values.description.trim(),
        url: values.url.trim() || null,
        content_type: values.content_type,
        content: values.content.trim() || null,
        folder_path: values.folder_path.trim() || undefined,
      });
      onCreated(item.id);
    } catch (err: unknown) {
      alerts.upsert(CREATE_ITEM_ERROR_ID, {
        tone: "danger",
        message: errorMessage(err),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSaving) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        showCloseButton={!isSaving}
      >
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>Новый элемент</DialogTitle>
          </DialogHeader>

          <ItemForm values={values} onChange={setValues} />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !values.title.trim()}
            >
              {isSaving ? "Сохранение…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
