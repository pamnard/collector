import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Masonry from "react-masonry-css";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemGridCard } from "./ItemGridCard";
import { MASONRY_BREAKPOINTS } from "./masonry-breakpoints";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useShell } from "../layout/AppLayout";
import { listTags, resolveItemThumbnailPaths } from "../../services/collector-service";
import type { useDashboardItems } from "../../hooks/useDashboardItems";

interface ItemGridViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
}

function itemThumbnailBatchKey(items: ItemFile[]): string {
  return items
    .map((item) => `${item.id}:${item.thumbnail ?? ""}:${item.updated_at}`)
    .join("|");
}

export function ItemGridView({ dashboard }: ItemGridViewProps) {
  const navigate = useNavigate();
  const { vaultRevision } = useShell();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [thumbnailPaths, setThumbnailPaths] = useState<
    Map<string, string | null>
  >(() => new Map());
  const thumbnailBatchKey = useMemo(
    () => itemThumbnailBatchKey(dashboard.items),
    [dashboard.items],
  );
  const sentinelRef = useInfiniteScroll({
    enabled: true,
    hasMore: dashboard.hasMore,
    isLoading: dashboard.isLoading || dashboard.isLoadingMore,
    onLoadMore: dashboard.loadMore,
  });

  useEffect(() => {
    void listTags().then(setTags);
  }, [vaultRevision]);

  useEffect(() => {
    let cancelled = false;

    if (!dashboard.items.length) {
      setThumbnailPaths(new Map());
      return () => {
        cancelled = true;
      };
    }

    void resolveItemThumbnailPaths(dashboard.items).then((paths) => {
      if (!cancelled) {
        setThumbnailPaths(paths);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [thumbnailBatchKey, dashboard.items]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  if (dashboard.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500" />
      </div>
    );
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
              thumbnailPath={
                thumbnailPaths.has(item.id)
                  ? thumbnailPaths.get(item.id) ?? null
                  : undefined
              }
              tagsById={tagsById}
              onOpen={(itemId) => navigate(`/item/${itemId}`)}
            />
          </div>
        ))}
      </Masonry>

      {dashboard.hasMore && (
        <div ref={sentinelRef} className="py-8 text-center text-secondary text-sm">
          {dashboard.isLoadingMore ? "Загрузка…" : "Прокрутите для следующих элементов"}
        </div>
      )}
    </>
  );
}
