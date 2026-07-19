import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Masonry from "react-masonry-css";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemGridCard } from "./ItemGridCard";
import { DashboardGridSkeleton } from "./DashboardListSkeleton";
import { MASONRY_BREAKPOINTS } from "./masonry-breakpoints";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useShell } from "../layout/AppLayout";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import { getCollectorClient } from "../../services/collector-client";

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
    enabled: !dashboard.isLoading,
    hasMore: dashboard.hasMore,
    isLoading: dashboard.isLoading || dashboard.isLoadingMore,
    onLoadMore: dashboard.loadMore,
  });

  useEffect(() => {
    void getCollectorClient().listTags().then(setTags);
  }, [vaultRevision]);

  useEffect(() => {
    let cancelled = false;

    if (!dashboard.items.length) {
      setThumbnailPaths(new Map());
      return () => {
        cancelled = true;
      };
    }

    const missing = dashboard.items.filter(
      (item) => !dashboard.thumbnailPaths.has(item.id),
    );
    if (missing.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void getCollectorClient().resolveItemThumbnailPaths(missing).then((paths) => {
      if (cancelled) {
        return;
      }
      setThumbnailPaths((current) => {
        const next = new Map(current);
        for (const [id, path] of paths) {
          next.set(id, path);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [thumbnailBatchKey, dashboard.items, dashboard.thumbnailPaths]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  if (dashboard.isLoading) {
    return <DashboardGridSkeleton />;
  }

  const resolveThumbnailPath = (itemId: string): string | null | undefined => {
    if (dashboard.thumbnailPaths.has(itemId)) {
      return dashboard.thumbnailPaths.get(itemId) ?? null;
    }
    if (thumbnailPaths.has(itemId)) {
      return thumbnailPaths.get(itemId) ?? null;
    }
    return undefined;
  };

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
              thumbnailPath={resolveThumbnailPath(item.id)}
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
