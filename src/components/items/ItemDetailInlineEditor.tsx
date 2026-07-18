import { CONTENT_TYPES, type ContentType } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";
import { FolderPicker } from "../folders/FolderPicker";
import { TagPicker } from "../tags/TagPicker";

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

interface ItemDetailInlineEditorProps {
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
}

export function ItemDetailInlineEditor({
  values,
  onChange,
}: ItemDetailInlineEditorProps) {
  const update = <K extends keyof ItemFormValues>(
    key: K,
    value: ItemFormValues[K],
  ) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <article className="space-y-6">
      <input
        type="text"
        required
        value={values.title}
        onChange={(event) => update("title", event.target.value)}
        placeholder="Название"
        className="w-full bg-transparent text-2xl font-semibold outline-none border-b border-border pb-2 focus:border-indigo-500/50"
      />

      <textarea
        value={values.description}
        onChange={(event) => update("description", event.target.value)}
        rows={2}
        placeholder="Описание"
        className="w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm resize-y"
      />

      <div className="grid gap-4 sm:grid-cols-2">
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
          <span className="text-sm font-medium">URL</span>
          <input
            type="url"
            value={values.url}
            onChange={(event) => update("url", event.target.value)}
            placeholder="https://"
            className="mt-1 w-full rounded-lg border border-border bg-input/20 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <FolderPicker
        value={values.folder_path}
        onChange={(folder_path) => update("folder_path", folder_path)}
      />

      <TagPicker
        selectedTagIds={values.tag_ids}
        onChange={(tag_ids) => update("tag_ids", tag_ids)}
      />

      <label className="block">
        <span className="text-sm font-medium">Содержимое (Markdown)</span>
        <textarea
          value={values.content}
          onChange={(event) => update("content", event.target.value)}
          rows={16}
          placeholder="Markdown…"
          className="mt-2 w-full bg-transparent px-0 py-0 text-sm font-mono leading-relaxed resize-y min-h-[320px] outline-none"
        />
      </label>
    </article>
  );
}
