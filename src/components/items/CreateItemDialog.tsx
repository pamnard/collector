import { useState } from "react";
import { X } from "lucide-react";
import { createItem } from "../../services/collector-service";
import { EMPTY_ITEM_FORM, type ItemFormValues } from "../../types/item";
import { ItemForm } from "./ItemForm";

interface CreateItemDialogProps {
  onClose: () => void;
  onCreated: (itemId: string) => void;
}

export function CreateItemDialog({ onClose, onCreated }: CreateItemDialogProps) {
  const [values, setValues] = useState<ItemFormValues>(EMPTY_ITEM_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.title.trim()) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const item = await createItem({
        title: values.title.trim(),
        description: values.description.trim(),
        url: values.url.trim() || null,
        content_type: values.content_type,
        content: values.content.trim() || null,
        folder_path: values.folder_path.trim() || undefined,
      });
      onCreated(item.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Новый элемент</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-secondary hover:bg-input/40 hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-400 text-sm whitespace-pre-wrap">
            {error}
          </pre>
        )}

        <ItemForm values={values} onChange={setValues} />

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg border border-border hover:bg-input/40 transition-colors text-sm"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isSaving || !values.title.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors text-sm disabled:opacity-50"
          >
            {isSaving ? "Сохранение…" : "Создать"}
          </button>
        </div>
      </form>
    </div>
  );
}
