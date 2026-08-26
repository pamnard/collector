import { lazy, Suspense, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ItemFormValues } from "../../types/item";
import { inferPropertyKind } from "../../lib/frontmatter-property-kind";
import { Spinner } from "../ui/spinner";
import { PRODUCT_PROPERTY_ROWS } from "./item-detail-inline-editor-helpers";
import { ItemDetailForeignValueEditor } from "./ItemDetailForeignValueEditor";
import { ItemDetailProductPropertyRows } from "./ItemDetailProductPropertyRows";
import { ItemDetailPropertyRow } from "./ItemDetailPropertyRow";

const ItemDetailSourceEditor = lazy(() =>
  import("./ItemDetailSourceEditor").then((m) => ({
    default: m.ItemDetailSourceEditor,
  })),
);

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
        className="w-full bg-transparent text-3xl font-bold tracking-tight leading-normal outline-hidden border-b border-black/10 dark:border-white/10 pb-2 focus:border-indigo-500/50"
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

      <div className="block">
        <span className="text-sm font-medium">Содержимое (Markdown)</span>
        <div className="mt-2">
          <Suspense
            fallback={
              <div className="flex min-h-48 items-center justify-center">
                <Spinner className="size-5" />
              </div>
            }
          >
            <ItemDetailSourceEditor
              value={values.content}
              onChange={(content) => update("content", content)}
              withFrontmatter={false}
              ariaLabel="Содержимое (Markdown)"
            />
          </Suspense>
        </div>
      </div>
    </article>
  );
}
