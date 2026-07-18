import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TagWithCount } from "@collector/core";
import { ItemRowActions } from "./ItemRowActions";
import { ItemTagBadges } from "./ItemTagBadges";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useShell } from "../layout/AppLayout";
import { listTags } from "../../services/collector-service";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import { formatItemDate } from "../../utils/formatItemDate";

interface ItemTableViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
  onUpdated: () => void;
}

export function ItemTableView({ dashboard, onUpdated }: ItemTableViewProps) {
  const navigate = useNavigate();
  const { vaultRevision } = useShell();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const sentinelRef = useInfiniteScroll({
    enabled: true,
    hasMore: dashboard.hasMore,
    isLoading: dashboard.isLoading || dashboard.isLoadingMore,
    onLoadMore: dashboard.loadMore,
  });

  useEffect(() => {
    void listTags().then(setTags);
  }, [vaultRevision]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  return (
    <>
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-input/30 text-secondary">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Название</th>
              <th className="text-left px-4 py-2 font-medium w-28">Тип</th>
              <th className="text-left px-4 py-2 font-medium min-w-[120px]">
                Теги
              </th>
              <th className="text-left px-4 py-2 font-medium w-28 whitespace-nowrap">
                Обновлено
              </th>
              <th className="text-right px-4 py-2 font-medium w-32">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {dashboard.items.map((item) => (
              <tr
                key={item.id}
                onClick={() => navigate(`/item/${item.id}`)}
                className="border-t border-border hover:bg-input/20 cursor-pointer [content-visibility:auto] [contain-intrinsic-size:56px]"
              >
                <td className="px-4 py-3">
                  <p className="font-medium truncate max-w-xs">{item.title}</p>
                  {item.description && (
                    <p className="text-secondary text-sm mt-1 line-clamp-1">
                      {item.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-secondary whitespace-nowrap">
                  {item.content_type}
                </td>
                <td className="px-4 py-3">
                  <ItemTagBadges tagIds={item.tag_ids} tagsById={tagsById} />
                </td>
                <td className="px-4 py-3 text-secondary whitespace-nowrap">
                  {formatItemDate(item.updated_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <ItemRowActions
                    itemId={item.id}
                    onUpdated={onUpdated}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dashboard.hasMore && (
        <div ref={sentinelRef} className="py-6 text-center text-secondary text-sm">
          {dashboard.isLoadingMore ? "Загрузка…" : "Прокрутите для следующих элементов"}
        </div>
      )}
    </>
  );
}
