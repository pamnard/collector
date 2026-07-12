import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TagWithCount } from "@collector/core";
import { ItemGridCard } from "./ItemGridCard";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { listTags } from "../../services/collector-service";
import type { useDashboardItems } from "../../hooks/useDashboardItems";

interface ItemGridViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
  onUpdated: () => void;
}

export function ItemGridView({ dashboard, onUpdated }: ItemGridViewProps) {
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
      <ul className="grid gap-3 sm:grid-cols-2">
        {dashboard.items.map((item) => (
          <li key={item.id}>
            <ItemGridCard
              item={item}
              tagsById={tagsById}
              onOpen={(itemId) => navigate(`/item/${itemId}`)}
              onUpdated={onUpdated}
            />
          </li>
        ))}
      </ul>

      {dashboard.hasMore && (
        <div ref={sentinelRef} className="py-6 text-center text-secondary text-sm">
          {dashboard.isLoadingMore ? "Загрузка…" : "Прокрутите для следующих элементов"}
        </div>
      )}
    </>
  );
}
