import { useEffect, useMemo, useState } from "react";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemTagBadges } from "../items/ItemTagBadges";
import { listTags } from "../../services/collector-service";
import { formatItemDate } from "../../utils/formatItemDate";

interface ItemDetailMetadataProps {
  item: ItemFile;
}

export function ItemDetailMetadata({ item }: ItemDetailMetadataProps) {
  const [tags, setTags] = useState<TagWithCount[]>([]);

  useEffect(() => {
    void listTags().then(setTags);
  }, [item.tag_ids.join(",")]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Метаданные</h2>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-secondary">Тип</dt>
          <dd className="mt-1">{item.content_type}</dd>
        </div>
        <div>
          <dt className="text-secondary">Обновлено</dt>
          <dd className="mt-1">{formatItemDate(item.updated_at)}</dd>
        </div>
        {item.folder_path && (
          <div className="sm:col-span-2">
            <dt className="text-secondary">Папка</dt>
            <dd className="mt-1 font-mono text-xs">{item.folder_path}</dd>
          </div>
        )}
        {item.url && (
          <div className="sm:col-span-2">
            <dt className="text-secondary">URL</dt>
            <dd className="mt-1">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 break-all hover:underline"
              >
                {item.url}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {item.tag_ids.length > 0 && (
        <div>
          <p className="text-secondary text-sm mb-2">Теги</p>
          <ItemTagBadges tagIds={item.tag_ids} tagsById={tagsById} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs text-muted">
        {item.is_favorite && (
          <span className="rounded-full bg-input px-2 py-1">избранное</span>
        )}
        {item.is_archived && (
          <span className="rounded-full bg-input px-2 py-1">архив</span>
        )}
      </div>
    </section>
  );
}
