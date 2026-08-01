import { CONTENT_TYPES, type ContentType } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";
import { FolderPicker } from "../folders/FolderPicker";
import { TagPicker } from "../tags/TagPicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

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
        className="w-full bg-transparent text-2xl font-semibold outline-hidden border-b border-black/10 dark:border-white/10 pb-2 focus:border-indigo-500/50"
      />

      <textarea
        value={values.description}
        onChange={(event) => update("description", event.target.value)}
        rows={2}
        placeholder="Описание"
        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm resize-y"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-sm font-medium">Тип</span>
          <Select
            value={values.content_type}
            onValueChange={(next) => {
              if (typeof next !== "string") {
                throw new Error("content_type must be a string");
              }
              update("content_type", next as ContentType);
            }}
            items={CONTENT_TYPES.map((type) => ({
              value: type,
              label: CONTENT_TYPE_LABELS[type],
            }))}
          >
            <SelectTrigger className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {CONTENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {CONTENT_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="block">
          <span className="text-sm font-medium">URL</span>
          <input
            type="url"
            value={values.url}
            onChange={(event) => update("url", event.target.value)}
            placeholder="https://"
            className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <FolderPicker
        value={values.folder_path}
        onChange={(folder_path) => update("folder_path", folder_path)}
      />

      <TagPicker
        selectedTagNames={values.tags}
        onChange={(tags) => update("tags", tags)}
      />

      <label className="block">
        <span className="text-sm font-medium">Содержимое (Markdown)</span>
        <textarea
          value={values.content}
          onChange={(event) => update("content", event.target.value)}
          rows={16}
          placeholder="Markdown…"
          className="mt-2 w-full bg-transparent px-0 py-0 text-sm font-mono leading-relaxed resize-y min-h-[320px] outline-hidden"
        />
      </label>
    </article>
  );
}
