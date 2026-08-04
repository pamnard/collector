import type { ItemFile } from "@collector/shared";
import type { ItemFormValues } from "../../types/item";

function sameProperties(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function toFormValues(
  item: ItemFile,
  content: string | null,
  tagNames: string[],
): ItemFormValues {
  return {
    title: item.title,
    description: item.description,
    url: item.url ?? "",
    content_type: item.content_type,
    content: content ?? "",
    tags: tagNames,
    folder_path: item.folder_path,
    properties: { ...item.properties },
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

export function sameTagNames(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].map((name) => name.trim().toLowerCase()).sort();
  const sortedB = [...b].map((name) => name.trim().toLowerCase()).sort();
  return sortedA.every((name, index) => name === sortedB[index]);
}

export function isFormDirty(
  form: ItemFormValues,
  item: ItemFile,
  content: string | null,
  itemTagNames: string[],
): boolean {
  return (
    form.title.trim() !== item.title ||
    form.description.trim() !== item.description ||
    (form.url.trim() || null) !== (item.url ?? null) ||
    form.content_type !== item.content_type ||
    form.content.trim() !== (content ?? "").trim() ||
    form.folder_path !== item.folder_path ||
    !sameTagNames(form.tags, itemTagNames) ||
    !sameProperties(form.properties, item.properties)
  );
}
