import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Masonry from "react-masonry-css";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemGridCard } from "./ItemGridCard";
import { DashboardGridSkeleton } from "./DashboardListSkeleton";
import { MASONRY_BREAKPOINTS } from "./masonry-breakpoints";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { coverNeedsResolve } from "../../lib/dashboard-commit";
import { useShell } from "../layout/AppLayout";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import {
  getCollectorService,
  getUiSession,
} from "../../services/collector-client";

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
  const scrollElement = useMainScrollElement();
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
    root: scrollElement,
  });

  useEffect(() => {
    void getCollectorService().tags.listTags().then(setTags);
  }, [vaultRevision]);

  useEffect(() => {
    if (!dashboard.items.length) {
      setThumbnailPaths(new Map());
      return;
    }

    const missing = dashboard.items.filter((item) =>
      coverNeedsResolve(
        item,
        dashboard.thumbnailPaths,
        dashboard.thumbnailStamps,
      ),
    );
    if (missing.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getUiSession().thumbnails.resolveItemThumbnailPathsProgressive(
      missing,
      {
        signal: controller.signal,
        onResolved: (id, path) => {
          if (controller.signal.aborted) {
            return;
          }
          setThumbnailPaths((current) => {
            const next = new Map(current);
            next.set(id, path);
            return next;
          });
        },
      },
    );

    return () => {
      controller.abort();
    };
  }, [
    thumbnailBatchKey,
    dashboard.items,
    dashboard.thumbnailPaths,
    dashboard.thumbnailStamps,
  ]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  if (dashboard.isLoading) {
    return <DashboardGridSkeleton />;
  }

  const resolveThumbnailPath = (item: ItemFile): string | null | undefined => {
    if (
      !coverNeedsResolve(
        item,
        dashboard.thumbnailPaths,
        dashboard.thumbnailStamps,
      )
    ) {
      return dashboard.thumbnailPaths.get(item.id) ?? null;
    }
    if (thumbnailPaths.has(item.id)) {
      return thumbnailPaths.get(item.id) ?? null;
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
              thumbnailPath={resolveThumbnailPath(item)}
              tagsById={tagsById}
              onOpen={(itemId) => navigate(`/item/${itemId}`)}
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
