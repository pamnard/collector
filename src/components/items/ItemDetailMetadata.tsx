import { useEffect, useState, type ReactNode } from "react";
import {
  Braces,
  Calendar,
  FileText,
  Folder,
  Hash,
  Link2,
  Tags,
  ToggleLeft,
  Type,
} from "lucide-react";
import { parseDocumentMarkdown } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { ExternalAnchor } from "../content/ExternalAnchor";
import {
  inferPropertyKind,
  type PropertyKind,
} from "../../lib/frontmatter-property-kind";
import { getCollectorService } from "../../services/collector-client";
import { errorMessage } from "../../services/runtime-error";
import { formatItemDate } from "../../utils/formatItemDate";

interface ItemDetailMetadataProps {
  item: ItemFile;
}

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

const METADATA_LOAD_ERROR_ID = "item-detail-metadata-load-error";

/** Frontmatter entries in document order (no re-sort). */
export function frontmatterEntriesFromRaw(
  rawMarkdown: string,
): Array<[string, unknown]> {
  const { frontmatter } = parseDocumentMarkdown(rawMarkdown);
  return Object.entries(frontmatter);
}

export function formatFrontmatterPropertyValue(
  key: string,
  value: unknown,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const kind = inferPropertyKind(key, value);
  if ((kind === "datetime" || kind === "date") && typeof value === "string") {
    return formatItemDate(value);
  }
  if (kind === "tags" && Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  if (kind === "json" || (value !== null && typeof value === "object")) {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return String(value);
}

function PropertyValueContent({
  propertyKey,
  value,
}: {
  propertyKey: string;
  value: unknown;
}): ReactNode {
  const kind = inferPropertyKind(propertyKey, value);
  if (kind === "url" && typeof value === "string" && value.length > 0) {
    return (
      <ExternalAnchor
        href={value}
        className="text-indigo-400 break-all hover:underline"
      >
        {value}
      </ExternalAnchor>
    );
  }
  const text = formatFrontmatterPropertyValue(propertyKey, value);
  if (kind === "json") {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs">
        {text}
      </pre>
    );
  }
  return text;
}

export function ItemDetailMetadata({ item }: ItemDetailMetadataProps) {
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([METADATA_LOAD_ERROR_ID]);
  const [entries, setEntries] = useState<Array<[string, unknown]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    alerts.dismiss(METADATA_LOAD_ERROR_ID);
    void getCollectorService()
      .items.getItemSource(item.id)
      .then((raw) => {
        if (cancelled) {
          return;
        }
        setEntries(frontmatterEntriesFromRaw(raw));
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const message = errorMessage(err);
        console.error("[ItemDetailMetadata] failed to load frontmatter", {
          itemId: item.id,
          message,
        });
        alerts.upsert(METADATA_LOAD_ERROR_ID, {
          tone: "danger",
          message: `Не удалось прочитать свойства файла: ${message}`,
        });
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.updated_at, alerts]);

  return (
    <section className="@container space-y-3">
      {entries === null && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">…</p>
      )}

      {entries !== null && entries.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Нет свойств во frontmatter.
        </p>
      )}

      {entries !== null && entries.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm @[280px]:grid-cols-[minmax(0,max-content)_minmax(0,1fr)]">
          {entries.map(([key, value]) => {
            const kind = inferPropertyKind(key, value);
            const Icon = KIND_ICON[kind];
            return (
              <div key={key} className="contents">
                <dt className="flex min-w-0 items-start gap-1.5 pt-0.5 text-neutral-500 dark:text-neutral-400">
                  <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span title={key}>{key}</span>
                </dt>
                <dd className="min-w-0 break-words whitespace-pre-wrap @[280px]:pt-0.5">
                  <PropertyValueContent propertyKey={key} value={value} />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
