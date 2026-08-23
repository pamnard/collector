import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ItemFormValues } from "../../types/item";
import { inferPropertyKind } from "../../lib/frontmatter-property-kind";
import { PRODUCT_PROPERTY_ROWS } from "./item-detail-inline-editor-helpers";
import { ItemDetailForeignValueEditor } from "./ItemDetailForeignValueEditor";
import { ItemDetailProductPropertyRows } from "./ItemDetailProductPropertyRows";
import { ItemDetailPropertyRow } from "./ItemDetailPropertyRow";

interface ItemDetailInlineEditorProps {
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
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
            <ItemDetailProductPropertyRows values={values} update={update} />

            {foreignKeys.map((propertyKey) => {
              const value = values.properties[propertyKey];
              const kind = inferPropertyKind(propertyKey, value);
              return (
                <ItemDetailPropertyRow
                  key={propertyKey}
                  label={propertyKey}
                  kind={kind}
                >
                  <ItemDetailForeignValueEditor
                    propertyKey={propertyKey}
                    value={value}
                    onChange={(next) =>
                      update("properties", {
                        ...values.properties,
                        [propertyKey]: next,
                      })
                    }
                  />
                </ItemDetailPropertyRow>
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
