import {
  foreignNumberInputValue,
  foreignTextInputValue,
  fromDatetimeLocalInput,
  toDateInputValue,
  toDatetimeLocalInputValue,
} from "./item-detail-inline-editor-helpers";
import { inferPropertyKind } from "../../lib/frontmatter-property-kind";

export function ItemDetailForeignValueEditor({
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
        value={foreignNumberInputValue(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
      />
    );
  }
  if (kind === "date") {
    return (
      <input
        type="date"
        value={toDateInputValue(value)}
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
        value={toDatetimeLocalInputValue(raw)}
        onChange={(event) => {
          onChange(
            fromDatetimeLocalInput(event.target.value, `Property ${propertyKey}`),
          );
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
      value={foreignTextInputValue(value)}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
    />
  );
}
