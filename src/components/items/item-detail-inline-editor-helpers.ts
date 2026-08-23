import type { ContentType } from "@collector/shared";
import {
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
import type { PropertyKind } from "../../lib/frontmatter-property-kind";

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  article: "Статья",
  video: "Видео",
  image: "Изображение",
  note: "Заметка",
  bookmark: "Закладка",
  pdf: "PDF",
  audio: "Аудио",
  other: "Другое",
};

export const KIND_ICON: Record<PropertyKind, typeof Type> = {
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

export type ProductPropertyKey =
  | "description"
  | "content_type"
  | "url"
  | "folder_path"
  | "tags"
  | "created_at"
  | "updated_at";

export const PRODUCT_PROPERTY_ROWS: Array<{
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

/** YYYY-MM-DD for `<input type="date">` when value starts with an ISO date. */
export function toDateInputValue(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : "";
}

/** First 16 chars (`YYYY-MM-DDTHH:mm`) for `<input type="datetime-local">`. */
export function toDatetimeLocalInputValue(iso: string): string {
  return iso.length >= 16 ? iso.slice(0, 16) : "";
}

export function fromDatetimeLocalInput(
  local: string,
  errorLabel: string,
): string {
  if (!local) {
    throw new Error(`${errorLabel}: empty datetime not allowed`);
  }
  return new Date(local).toISOString();
}

export function foreignNumberInputValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value) || 0;
}

export function foreignTextInputValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
