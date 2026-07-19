import { useEffect, useMemo, useState } from "react";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ExternalAnchor } from "../content/ExternalAnchor";
import { ItemTagBadges } from "../items/ItemTagBadges";
import { formatItemDate } from "../../utils/formatItemDate";
import { getCollectorClient } from "../../services/collector-client";

interface ItemDetailMetadataProps {
  item: ItemFile;
}

export function ItemDetailMetadata({ item }: ItemDetailMetadataProps) {
  const [tags, setTags] = useState<TagWithCount[]>([]);

  useEffect(() => {
    void getCollectorClient().listTags().then(setTags);
  }, [item.tag_ids.join(",")]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Метаданные</h2>

      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-secondary">Тип</dt>
          <dd className="mt-1">{item.content_type}</dd>
        </div>
        <div>
          <dt className="text-secondary">Создано</dt>
          <dd className="mt-1">{formatItemDate(item.created_at)}</dd>
        </div>
        <div>
          <dt className="text-secondary">Обновлено</dt>
          <dd className="mt-1">{formatItemDate(item.updated_at)}</dd>
        </div>
        {item.folder_path && (
          <div>
            <dt className="text-secondary">Папка</dt>
            <dd className="mt-1">{item.folder_path}</dd>
          </div>
        )}
        {item.url && (
          <div>
            <dt className="text-secondary">URL</dt>
            <dd className="mt-1">
              <ExternalAnchor
                href={item.url}
                className="text-indigo-400 break-all hover:underline"
              >
                {item.url}
              </ExternalAnchor>
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
    </section>
  );
}
