import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Link2,
  Calendar,
  Hash,
  ToggleLeft,
  Braces,
  Folder,
  Tags,
  Type,
} from "lucide-react";
import { CONTENT_TYPES, type ContentType } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";
import {
  inferPropertyKind,
  type PropertyKind,
} from "../../lib/frontmatter-property-kind";
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

const KIND_ICON: Record<PropertyKind, typeof Type> = {
  text: Type,
  url: Link2,
  date: Calendar,
  datetime: Calendar,
  number: Hash,
  boolean: ToggleLeft,
  tags: Tags,
  folder: Folder,
  content_type: FileText,
  json: Braces,
};

type ProductPropertyKey =
  | "description"
  | "content_type"
  | "url"
  | "folder_path"
  | "tags"
  | "created_at"
  | "updated_at";

const PRODUCT_PROPERTY_ROWS: Array<{
  key: ProductPropertyKey;
  label: string;
}> = [
  { key: "description", label: "Описание" },
  { key: "content_type", label: "Тип" },
  { key: "url", label: "URL" },
  { key: "folder_path", label: "Папка" },
  { key: "tags", label: "Теги" },
  { key: "created_at", label: "Создано" },
  { key: "updated_at", label: "Обновлено" },
];

interface ItemDetailInlineEditorProps {
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
}

function PropertyRowShell({
  label,
  kind,
  children,
}: {
  label: string;
  kind: PropertyKind;
  children: ReactNode;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex shrink-0 items-center gap-2 sm:w-40 sm:pt-2">
        <Icon className="size-4 text-neutral-500 dark:text-neutral-400" aria-hidden />
        <span className="text-sm font-medium truncate" title={label}>
          {label}
        </span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ForeignValueEditor({
  propertyKey,
  value,
  onChange,
}: {
  propertyKey: string;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const kind = inferPropertyKind(propertyKey, value);
  if (kind === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {Boolean(value) ? "да" : "нет"}
      </label>
    );
  }
  if (kind === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : Number(value) || 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
      />
    );
  }
  if (kind === "date") {
    const dateValue =
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
        ? value.slice(0, 10)
        : "";
    return (
      <input
        type="date"
        value={dateValue}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
      />
    );
  }
  if (kind === "datetime") {
    const raw = typeof value === "string" ? value : "";
    return (
      <input
        type="datetime-local"
        value={raw.length >= 16 ? raw.slice(0, 16) : ""}
        onChange={(event) => {
          const local = event.target.value;
          if (!local) {
            throw new Error(`Property ${propertyKey}: empty datetime not allowed`);
          }
          onChange(new Date(local).toISOString());
        }}
        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
      />
    );
  }
  if (kind === "url") {
    return (
      <input
        type="url"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://"
        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
      />
    );
  }
  if (kind === "json") {
    return (
      <textarea
        rows={3}
        value={JSON.stringify(value, null, 2)}
        onChange={(event) => {
          const parsed: unknown = JSON.parse(event.target.value);
          onChange(parsed);
        }}
        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm font-mono"
      />
    );
  }
  return (
    <input
      type="text"
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
    />
  );
}

export function ItemDetailInlineEditor({
  values,
  onChange,
}: ItemDetailInlineEditorProps) {
  const [propertiesOpen, setPropertiesOpen] = useState(false);

  const update = <K extends keyof ItemFormValues>(
    key: K,
    value: ItemFormValues[K],
  ) => {
    onChange({ ...values, [key]: value });
  };

  const foreignKeys = Object.keys(values.properties).sort();

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

      <div className="border-y border-black/10 dark:border-white/10">
        <button
          type="button"
          className="flex w-full items-center gap-2 py-3 text-sm font-medium text-neutral-700 dark:text-neutral-200"
          onClick={() => setPropertiesOpen((open) => !open)}
          aria-expanded={propertiesOpen}
        >
          {propertiesOpen ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
          Свойства
          <span className="text-neutral-500 dark:text-neutral-400 font-normal">
            ({PRODUCT_PROPERTY_ROWS.length + foreignKeys.length})
          </span>
        </button>

        {propertiesOpen && (
          <div className="flex flex-col gap-4 pb-4">
            {PRODUCT_PROPERTY_ROWS.map(({ key, label }) => {
              if (key === "description") {
                return (
                  <PropertyRowShell key={key} label={label} kind="text">
                    <textarea
                      value={values.description}
                      onChange={(event) => update("description", event.target.value)}
                      rows={2}
                      placeholder="Описание"
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm resize-y"
                    />
                  </PropertyRowShell>
                );
              }
              if (key === "content_type") {
                return (
                  <PropertyRowShell key={key} label={label} kind="content_type">
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
                      <SelectTrigger className="w-full">
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
                  </PropertyRowShell>
                );
              }
              if (key === "url") {
                return (
                  <PropertyRowShell key={key} label={label} kind="url">
                    <input
                      type="url"
                      value={values.url}
                      onChange={(event) => update("url", event.target.value)}
                      placeholder="https://"
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
                    />
                  </PropertyRowShell>
                );
              }
              if (key === "folder_path") {
                return (
                  <PropertyRowShell key={key} label={label} kind="folder">
                    <FolderPicker
                      value={values.folder_path}
                      onChange={(folder_path) => update("folder_path", folder_path)}
                    />
                  </PropertyRowShell>
                );
              }
              if (key === "tags") {
                return (
                  <PropertyRowShell key={key} label={label} kind="tags">
                    <TagPicker
                      selectedTagNames={values.tags}
                      onChange={(tags) => update("tags", tags)}
                    />
                  </PropertyRowShell>
                );
              }
              if (key === "created_at" || key === "updated_at") {
                const iso = values[key];
                return (
                  <PropertyRowShell key={key} label={label} kind="datetime">
                    <input
                      type="datetime-local"
                      value={iso.length >= 16 ? iso.slice(0, 16) : ""}
                      onChange={(event) => {
                        const local = event.target.value;
                        if (!local) {
                          throw new Error(`${key}: empty datetime not allowed`);
                        }
                        update(key, new Date(local).toISOString());
                      }}
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
                    />
                  </PropertyRowShell>
                );
              }
              throw new Error(`Unhandled product property row: ${key}`);
            })}

            {foreignKeys.map((propertyKey) => {
              const value = values.properties[propertyKey];
              const kind = inferPropertyKind(propertyKey, value);
              return (
                <PropertyRowShell key={propertyKey} label={propertyKey} kind={kind}>
                  <ForeignValueEditor
                    propertyKey={propertyKey}
                    value={value}
                    onChange={(next) =>
                      update("properties", {
                        ...values.properties,
                        [propertyKey]: next,
                      })
                    }
                  />
                </PropertyRowShell>
              );
            })}
          </div>
        )}
      </div>

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
