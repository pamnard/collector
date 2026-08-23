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
import {
  CONTENT_TYPE_LABELS,
  fromDatetimeLocalInput,
  PRODUCT_PROPERTY_ROWS,
  toDatetimeLocalInputValue,
} from "./item-detail-inline-editor-helpers";
import { ItemDetailPropertyRow } from "./ItemDetailPropertyRow";

export function ItemDetailProductPropertyRows({
  values,
  update,
}: {
  values: ItemFormValues;
  update: <K extends keyof ItemFormValues>(
    key: K,
    value: ItemFormValues[K],
  ) => void;
}) {
  return (
    <>
      {PRODUCT_PROPERTY_ROWS.map(({ key, label }) => {
        if (key === "description") {
          return (
            <ItemDetailPropertyRow key={key} label={label} kind="text">
              <textarea
                value={values.description}
                onChange={(event) => update("description", event.target.value)}
                rows={2}
                placeholder="Описание"
                className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm resize-y"
              />
            </ItemDetailPropertyRow>
          );
        }
        if (key === "content_type") {
          return (
            <ItemDetailPropertyRow key={key} label={label} kind="content_type">
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
            </ItemDetailPropertyRow>
          );
        }
        if (key === "url") {
          return (
            <ItemDetailPropertyRow key={key} label={label} kind="url">
              <input
                type="url"
                value={values.url}
                onChange={(event) => update("url", event.target.value)}
                placeholder="https://"
                className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
              />
            </ItemDetailPropertyRow>
          );
        }
        if (key === "folder_path") {
          return (
            <ItemDetailPropertyRow key={key} label={label} kind="folder">
              <FolderPicker
                value={values.folder_path}
                onChange={(folder_path) => update("folder_path", folder_path)}
              />
            </ItemDetailPropertyRow>
          );
        }
        if (key === "tags") {
          return (
            <ItemDetailPropertyRow key={key} label={label} kind="tags">
              <TagPicker
                selectedTagNames={values.tags}
                onChange={(tags) => update("tags", tags)}
              />
            </ItemDetailPropertyRow>
          );
        }
        if (key === "created_at" || key === "updated_at") {
          const iso = values[key];
          return (
            <ItemDetailPropertyRow key={key} label={label} kind="datetime">
              <input
                type="datetime-local"
                value={toDatetimeLocalInputValue(iso)}
                onChange={(event) => {
                  update(key, fromDatetimeLocalInput(event.target.value, key));
                }}
                className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
              />
            </ItemDetailPropertyRow>
          );
        }
        throw new Error(`Unhandled product property row: ${key}`);
      })}
    </>
  );
}
