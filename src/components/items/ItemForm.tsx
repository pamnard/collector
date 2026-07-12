import { CONTENT_TYPES, type ContentType } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  article: "Статья",
  video: "Видео",
  image: "Изображение",
  note: "Заметка",
  bookmark: "Закладка",
  pdf: "PDF",
  audio: "Аудио",
  other: "Другое",
};

interface ItemFormProps {
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
  showFlags?: boolean;
}

export function ItemForm({ values, onChange, showFlags = false }: ItemFormProps) {
  const update = <K extends keyof ItemFormValues>(
    key: K,
    value: ItemFormValues[K],
  ) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Название</span>
        <input
          type="text"
          required
          value={values.title}
          onChange={(event) => update("title", event.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Тип</span>
        <select
          value={values.content_type}
          onChange={(event) =>
            update("content_type", event.target.value as ContentType)
          }
          className="mt-1 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm"
        >
          {CONTENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CONTENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Описание</span>
        <textarea
          value={values.description}
          onChange={(event) => update("description", event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">URL</span>
        <input
          type="url"
          value={values.url}
          onChange={(event) => update("url", event.target.value)}
          placeholder="https://"
          className="mt-1 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Содержимое</span>
        <textarea
          value={values.content}
          onChange={(event) => update("content", event.target.value)}
          rows={8}
          placeholder="Markdown…"
          className="mt-1 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm font-mono resize-y"
        />
      </label>

      {showFlags && (
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.is_favorite}
              onChange={(event) => update("is_favorite", event.target.checked)}
              className="rounded border-border"
            />
            Избранное
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.is_archived}
              onChange={(event) => update("is_archived", event.target.checked)}
              className="rounded border-border"
            />
            Архив
          </label>
        </div>
      )}
    </div>
  );
}
