import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Masonry from "react-masonry-css";
import type { TagWithCount } from "@collector/core";
import { ItemGridCard } from "./ItemGridCard";
import { DashboardGridSkeleton } from "./DashboardListSkeleton";
import { useMasonryColumnCount } from "./use-masonry-column-count";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import {
  coverMapsResolveForGrid,
  type CoverMaps,
} from "../../lib/cover-maps";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfCompleteRunWithoutL3,
  dashboardPerfEndPhase,
  dashboardPerfObserveL1,
  dashboardPerfObserveL2,
  dashboardPerfRunExpectsViewMode,
} from "../../lib/dashboard-perf";
import { useShell } from "../layout/AppLayout";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import { getCollectorService } from "../../services/collector-client";

interface ItemGridViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
}

function gridMayAwaitCoverDecode(
  items: ReturnType<typeof useDashboardItems>["items"],
  coverMaps: CoverMaps,
): boolean {
  return items.some((item) => {
    const { path } = coverMapsResolveForGrid(coverMaps, item);
    return path !== null;
  });
}

export function ItemGridView({ dashboard }: ItemGridViewProps) {
  const navigate = useNavigate();
  const { vaultRevision, viewMode } = useShell();
  const scrollElement = useMainScrollElement();
  const gridRootRef = useRef<HTMLDivElement>(null);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const l2ReportedRef = useRef(false);
  const gridVisible = viewMode === "grid";
  const columnCount = useMasonryColumnCount();
  const sentinelRef = useInfiniteScroll({
    enabled: gridVisible && !dashboard.isLoading,
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

  useLayoutEffect(() => {
    if (!gridVisible) {
      l2ReportedRef.current = false;
      return;
    }
    if (!dashboard.isLoading) {
      l2ReportedRef.current = false;
    }
  }, [gridVisible, dashboard.isLoading, dashboard.items]);

  useLayoutEffect(() => {
    if (!gridVisible || dashboard.isLoading || l2ReportedRef.current) {
      return;
    }
    const runId = dashboardPerfActiveRunId();
    if (
      !runId ||
      !dashboardPerfRunExpectsViewMode(runId, "grid") ||
      dashboard.items.length === 0
    ) {
      return;
    }
    const cards = gridRootRef.current?.querySelectorAll("[data-dashboard-card]");
    if (!cards?.length) {
      return;
    }
    l2ReportedRef.current = true;
    dashboardPerfBeginPhase(runId, "gridMount");
    dashboardPerfObserveL1(runId);
    dashboardPerfEndPhase(runId, "gridMount");
    dashboardPerfBeginPhase(runId, "gridLayout");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!dashboardPerfRunExpectsViewMode(runId, "grid")) {
          return;
        }
        dashboardPerfEndPhase(runId, "gridLayout");
        dashboardPerfObserveL2(runId);
        if (
          !gridMayAwaitCoverDecode(dashboard.items, dashboard.coverMaps)
        ) {
          dashboardPerfCompleteRunWithoutL3(runId);
        }
      });
    });
  }, [
    dashboard.isLoading,
    dashboard.items,
    dashboard.coverMaps,
    gridVisible,
  ]);

  if (dashboard.isLoading) {
    return <DashboardGridSkeleton />;
  }

  const { coverMaps } = dashboard;

  return (
    <div ref={gridRootRef}>
      <Masonry
        breakpointCols={columnCount}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {dashboard.items.map((item) => {
          const { path: thumbnailPath, size: thumbnailSize } =
            coverMapsResolveForGrid(coverMaps, item);
          return (
            <div key={item.id} data-dashboard-card>
              <ItemGridCard
                item={item}
                tagsById={tagsById}
                thumbnailPath={thumbnailPath}
                thumbnailSize={thumbnailSize}
                onOpen={handleOpenItem}
              />
            </div>
          );
        })}
      </Masonry>

      {dashboard.hasMore && (
        <div
          ref={sentinelRef}
          className="py-8 text-center text-neutral-500 dark:text-neutral-400 text-sm"
        >
          {dashboard.isLoadingMore
            ? "Загрузка…"
            : "Прокрутите для следующих элементов"}
        </div>
      )}
    </div>
  );
}
