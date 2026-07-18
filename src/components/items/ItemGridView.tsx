import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { ItemGridCard } from "./ItemGridCard";
import { DashboardGridSkeleton } from "./DashboardListSkeleton";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useShell } from "../layout/AppLayout";
import { dashboardGridColumnCount } from "../../lib/dashboard-column-count";
import { listTags, resolveItemThumbnailPaths } from "../../services/collector-service";
import type { useDashboardItems } from "../../hooks/useDashboardItems";

interface ItemGridViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
}

const GRID_ROW_ESTIMATE_PX = 320;
const GRID_ROW_OVERSCAN = 3;

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
  const [columnCount, setColumnCount] = useState(() =>
    dashboardGridColumnCount(window.innerWidth),
  );
  const scrollElement = useMainScrollElement();
  const gridTopRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
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
    void listTags().then(setTags);
  }, [vaultRevision]);

  useEffect(() => {
    const onResize = () => {
      setColumnCount(dashboardGridColumnCount(window.innerWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    if (!gridTopRef.current || !scrollElement) {
      return;
    }
    setScrollMargin(gridTopRef.current.offsetTop);
  }, [scrollElement, dashboard.items.length, columnCount]);

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

    void resolveItemThumbnailPaths(missing).then((paths) => {
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

  const rowCount = Math.ceil(dashboard.items.length / columnCount) || 0;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => GRID_ROW_ESTIMATE_PX,
    overscan: GRID_ROW_OVERSCAN,
    scrollMargin,
  });

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

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <>
      <div
        ref={gridTopRef}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columnCount;
          const rowItems = dashboard.items.slice(
            startIndex,
            startIndex + columnCount,
          );
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                }}
              >
                {rowItems.map((item) => (
                  <ItemGridCard
                    key={item.id}
                    item={item}
                    thumbnailPath={resolveThumbnailPath(item.id)}
                    tagsById={tagsById}
                    onOpen={(itemId) => navigate(`/item/${itemId}`)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {dashboard.hasMore && (
        <div ref={sentinelRef} className="py-8 text-center text-secondary text-sm">
          {dashboard.isLoadingMore ? "Загрузка…" : "Прокрутите для следующих элементов"}
        </div>
      )}
    </>
  );
}
