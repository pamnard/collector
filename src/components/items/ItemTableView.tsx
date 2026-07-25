import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TagWithCount } from "@collector/core";
import { ItemRowActions } from "./ItemRowActions";
import { ItemTagBadges } from "./ItemTagBadges";
import { DashboardTableSkeleton } from "./DashboardListSkeleton";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useShell } from "../layout/AppLayout";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import { formatItemDate } from "../../utils/formatItemDate";
import { getCollectorClient } from "../../services/collector-client";

interface ItemTableViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
  onUpdated: () => void;
}

const ROW_ESTIMATE_PX = 56;
const ROW_OVERSCAN = 10;

export function ItemTableView({ dashboard, onUpdated }: ItemTableViewProps) {
  const navigate = useNavigate();
  const { vaultRevision } = useShell();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const scrollElement = useMainScrollElement();
  const tableTopRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const sentinelRef = useInfiniteScroll({
    enabled: !dashboard.isLoading,
    hasMore: dashboard.hasMore,
    isLoading: dashboard.isLoading || dashboard.isLoadingMore,
    onLoadMore: dashboard.loadMore,
  });

  useEffect(() => {
    void getCollectorClient().listTags().then(setTags);
  }, [vaultRevision]);

  useLayoutEffect(() => {
    if (!tableTopRef.current || !scrollElement) {
      return;
    }
    setScrollMargin(tableTopRef.current.offsetTop);
  }, [scrollElement, dashboard.items.length]);

  const tagsById = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  const virtualizer = useVirtualizer({
    count: dashboard.items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: ROW_OVERSCAN,
    scrollMargin,
  });

  if (dashboard.isLoading) {
    return <DashboardTableSkeleton />;
  }

  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop =
    virtualRows.length > 0
      ? Math.max(0, (virtualRows[0]?.start ?? 0) - scrollMargin)
      : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? Math.max(
          0,
          virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0),
        )
      : 0;

  return (
    <>
      <div
        ref={tableTopRef}
        className="rounded-lg border border-black/10 dark:border-white/10 overflow-x-auto"
      >
        <table className="w-full table-fixed text-sm">
          <thead className="bg-neutral-100/30 dark:bg-neutral-700/30 text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Название</th>
              <th className="w-28 text-left px-4 py-2 font-medium">Тип</th>
              <th className="w-40 text-left px-4 py-2 font-medium">Теги</th>
              <th className="w-28 text-left px-4 py-2 font-medium whitespace-nowrap">
                Обновлено
              </th>
              <th className="w-32 text-right px-4 py-2 font-medium">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 ? (
              <tr aria-hidden>
                <td colSpan={5} style={{ height: paddingTop, padding: 0 }} />
              </tr>
            ) : null}
            {virtualRows.map((virtualRow) => {
              const item = dashboard.items[virtualRow.index]!;
              return (
                <tr
                  key={item.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  onClick={() => navigate(`/item/${item.id}`)}
                  className="border-t border-black/10 dark:border-white/10 hover:bg-neutral-100/20 dark:hover:bg-neutral-700/20 cursor-pointer"
                >
                  <td className="overflow-hidden px-4 py-3">
                    <p className="truncate font-medium">{item.title}</p>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                    {item.content_type}
                  </td>
                  <td className="px-4 py-3">
                    <ItemTagBadges tagIds={item.tag_ids} tagsById={tagsById} />
                  </td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                    {formatItemDate(item.updated_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ItemRowActions itemId={item.id} onUpdated={onUpdated} />
                  </td>
                </tr>
              );
            })}
            {paddingBottom > 0 ? (
              <tr aria-hidden>
                <td colSpan={5} style={{ height: paddingBottom, padding: 0 }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dashboard.hasMore && (
        <div ref={sentinelRef} className="py-6 text-center text-neutral-500 dark:text-neutral-400 text-sm">
          {dashboard.isLoadingMore ? "Загрузка…" : "Прокрутите для следующих элементов"}
        </div>
      )}
    </>
  );
}
