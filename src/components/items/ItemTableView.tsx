import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TagWithCount } from "@collector/core";
import { ItemFlagActions } from "./ItemFlagActions";
import { ItemTagBadges } from "./ItemTagBadges";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { listTags } from "../../services/collector-service";
import type { useDashboardItems } from "../../hooks/useDashboardItems";

interface ItemTableViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
  onUpdated: () => void;
}

export function ItemTableView({ dashboard, onUpdated }: ItemTableViewProps) {
  const navigate = useNavigate();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const sentinelRef = useInfiniteScroll({
    enabled: true,
    hasMore: dashboard.hasMore,
    isLoading: dashboard.isLoading || dashboard.isLoadingMore,
    onLoadMore: dashboard.loadMore,
  });

  useEffect(() => {
    void listTags().then(setTags);
  }, [dashboard.totalCount]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  return (
    <>
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-input/30 text-secondary">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Название</th>
              <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">
                Тип
              </th>
              <th className="text-left px-4 py-2 font-medium hidden md:table-cell">
                Теги
              </th>
              <th className="text-right px-4 py-2 font-medium w-24">
                Флаги
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
                  <p>{item.title}</p>
                  {item.description && (
                    <p className="text-secondary text-xs mt-1 line-clamp-1 md:hidden">
                      {item.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-secondary hidden sm:table-cell">
                  {item.content_type}
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <ItemTagBadges tagIds={item.tag_ids} tagsById={tagsById} />
                </td>
                <td className="px-4 py-3 text-right">
                  <ItemFlagActions
                    itemId={item.id}
                    isFavorite={item.is_favorite}
                    isArchived={item.is_archived}
                    onUpdated={onUpdated}
                    compact
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
