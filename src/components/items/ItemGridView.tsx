import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Masonry from "react-masonry-css";
import type { TagWithCount } from "@collector/core";
import { ItemGridCard } from "./ItemGridCard";
import { DashboardGridSkeleton } from "./DashboardListSkeleton";
import { MASONRY_BREAKPOINTS } from "./masonry-breakpoints";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { resolveDashboardGridThumbnailPath } from "../../lib/dashboard-commit";
import { useShell } from "../layout/AppLayout";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import { getCollectorService } from "../../services/collector-client";

interface ItemGridViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
}

export function ItemGridView({ dashboard }: ItemGridViewProps) {
  const navigate = useNavigate();
  const { vaultRevision } = useShell();
  const scrollElement = useMainScrollElement();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const sentinelRef = useInfiniteScroll({
    enabled: !dashboard.isLoading,
    hasMore: dashboard.hasMore,
    isLoading: dashboard.isLoading || dashboard.isLoadingMore,
    onLoadMore: dashboard.loadMore,
    root: scrollElement,
  });

  useEffect(() => {
    void getCollectorService().tags.listTags().then(setTags);
  }, [vaultRevision]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  const handleOpenItem = useCallback(
    (itemId: string) => navigate(`/item/${itemId}`),
    [navigate],
  );

  if (dashboard.isLoading) {
    return <DashboardGridSkeleton />;
  }

  return (
    <>
      <Masonry
        breakpointCols={MASONRY_BREAKPOINTS}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {dashboard.items.map((item) => (
          <div key={item.id}>
            <ItemGridCard
              item={item}
              thumbnailPath={resolveDashboardGridThumbnailPath(
                item,
                dashboard.thumbnailPaths,
                dashboard.thumbnailStamps,
              )}
              tagsById={tagsById}
              onOpen={handleOpenItem}
            />
          </div>
        ))}
      </Masonry>

      {dashboard.hasMore && (
        <div ref={sentinelRef} className="py-8 text-center text-neutral-500 dark:text-neutral-400 text-sm">
          {dashboard.isLoadingMore ? "Загрузка…" : "Прокрутите для следующих элементов"}
        </div>
      )}
    </>
  );
}
