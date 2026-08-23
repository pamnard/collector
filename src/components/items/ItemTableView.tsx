import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from "@tanstack/react-table";
import type { ItemFile } from "@collector/shared";
import { DashboardTableSkeleton } from "./DashboardListSkeleton";
import { selectionQueryKey } from "./table/dashboard-table-selection";
import {
  itemTableCellClassName,
  itemTableHeaderClassName,
} from "./table/item-table-column-class";
import { ITEM_TABLE_COLUMN_SPECS } from "./table/item-table-column-specs";
import { createItemTableColumns } from "./table/item-table-columns";
import { ItemTableToolbar } from "./table/item-table-toolbar";
import { itemTableVirtualPadding } from "./table/item-table-virtual-padding";
import { resolveColumnVisibility } from "./table/resolve-column-visibility";
import { useDashboardTableSelection } from "./table/use-dashboard-table-selection";
import { useItemTableTags } from "./table/use-item-table-tags";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useShell } from "../layout/AppLayout";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import { navFilterKey } from "../../types/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfCompleteRunWithoutL3,
  dashboardPerfEndPhase,
  dashboardPerfObserveL1,
  dashboardPerfObserveL2,
  dashboardPerfRunExpectsViewMode,
} from "../../lib/dashboard-perf";

interface ItemTableViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
  onUpdated?: () => void;
}

const ROW_ESTIMATE_PX = 40;
const ROW_OVERSCAN = 10;

export function ItemTableView({ dashboard, onUpdated }: ItemTableViewProps) {
  const navigate = useNavigate();
  const { activeFilter, dashboardSort, setDashboardSort, viewMode } =
    useShell();
  const { settings, setTableColumnVisibility } = useAppSettings();
  const tagsById = useItemTableTags();
  const scrollElement = useMainScrollElement();
  const tableTopRef = useRef<HTMLDivElement>(null);
  const l2ReportedRef = useRef(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const tableVisible = viewMode === "table";
  const sentinelRef = useInfiniteScroll({
    enabled: tableVisible && !dashboard.isLoading,
    hasMore: dashboard.hasMore,
    isLoading: dashboard.isLoading || dashboard.isLoadingMore,
    onLoadMore: dashboard.loadMore,
    root: scrollElement,
  });

  const loadedIds = useMemo(
    () => dashboard.items.map((item) => item.id),
    [dashboard.items],
  );

  const queryKey = selectionQueryKey({
    vaultId: settings.active_vault_id ?? "",
    filterKey: navFilterKey(activeFilter),
    search: "",
    sortKey: dashboardSort.key,
    sortDir: dashboardSort.dir,
  });

  const selection = useDashboardTableSelection({
    queryKey,
    loadedIds,
    totalCount: dashboard.totalCount,
  });

  useLayoutEffect(() => {
    if (!tableVisible || !tableTopRef.current || !scrollElement) {
      return;
    }
    setScrollMargin(tableTopRef.current.offsetTop);
  }, [scrollElement, dashboard.items.length, tableVisible]);

  const columns = useMemo<ColumnDef<ItemFile>[]>(
    () =>
      createItemTableColumns({
        tagsById,
        onUpdated,
        selection: {
          loadedState: selection.loadedState,
          isRowSelected: selection.isRowSelected,
          onToggleRow: selection.toggleRow,
          onSetLoadedSelected: selection.setLoadedSelected,
        },
        sort: {
          sort: dashboardSort,
          onSortChange: setDashboardSort,
        },
      }),
    [
      tagsById,
      onUpdated,
      selection.loadedState,
      selection.isRowSelected,
      selection.toggleRow,
      selection.setLoadedSelected,
      dashboardSort,
      setDashboardSort,
    ],
  );

  const columnVisibility = useMemo(
    () =>
      resolveColumnVisibility(
        ITEM_TABLE_COLUMN_SPECS,
        settings.table_column_visibility,
      ) as VisibilityState,
    [settings.table_column_visibility],
  );

  const table = useReactTable({
    data: dashboard.items,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnVisibility) : updater;
      const resolved = resolveColumnVisibility(
        ITEM_TABLE_COLUMN_SPECS,
        next as Record<string, boolean>,
      );
      void setTableColumnVisibility(resolved);
    },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
    enableSortingRemoval: false,
  });

  const rows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: ROW_OVERSCAN,
    scrollMargin,
  });

  useLayoutEffect(() => {
    l2ReportedRef.current = false;
  }, [tableVisible, dashboard.isLoading, dashboard.items]);

  useLayoutEffect(() => {
    if (!tableVisible || dashboard.isLoading || l2ReportedRef.current) {
      return;
    }
    const runId = dashboardPerfActiveRunId();
    if (
      !runId ||
      !dashboardPerfRunExpectsViewMode(runId, "table") ||
      rows.length === 0
    ) {
      return;
    }
    l2ReportedRef.current = true;
    dashboardPerfBeginPhase(runId, "tableMount");
    dashboardPerfObserveL1(runId);
    dashboardPerfEndPhase(runId, "tableMount");
    dashboardPerfObserveL2(runId);
    dashboardPerfCompleteRunWithoutL3(runId);
  }, [dashboard.isLoading, dashboard.items, rows.length, tableVisible]);

  if (dashboard.isLoading) {
    return <DashboardTableSkeleton />;
  }

  const virtualRows = virtualizer.getVirtualItems();
  const { paddingTop, paddingBottom } = itemTableVirtualPadding(
    virtualRows,
    virtualizer.getTotalSize(),
    scrollMargin,
  );

  return (
    <>
      <ItemTableToolbar
        selectedCount={selection.selectedCount}
        totalCount={dashboard.totalCount}
        showSelectAllMatching={selection.showSelectAllMatching}
        onSelectAllMatching={() => {
          selection.selectAllMatching();
        }}
        table={table}
        columnVisibility={columnVisibility}
      />

      <div
        ref={tableTopRef}
        className="rounded-lg border border-black/10 dark:border-white/10"
      >
        <Table className="table-fixed">
          <TableHeader className="bg-neutral-100/30 dark:bg-neutral-700/30 text-neutral-500 dark:text-neutral-400 [&_tr]:border-black/10 dark:[&_tr]:border-white/10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={itemTableHeaderClassName(header.column.id)}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {paddingTop > 0 ? (
              <TableRow aria-hidden className="hover:bg-transparent border-0">
                <TableCell
                  colSpan={visibleColumnCount}
                  style={{ height: paddingTop, padding: 0 }}
                />
              </TableRow>
            ) : null}
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index]!;
              const item = row.original;
              const selected = selection.isRowSelected(item.id);
              return (
                <TableRow
                  key={row.id}
                  data-index={virtualRow.index}
                  data-state={selected ? "selected" : undefined}
                  ref={virtualizer.measureElement}
                  onClick={() => navigate(`/item/${item.id}`)}
                  className="border-black/10 dark:border-white/10 hover:bg-neutral-100/20 dark:hover:bg-neutral-700/20 cursor-pointer"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={itemTableCellClassName(cell.column.id)}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {paddingBottom > 0 ? (
              <TableRow aria-hidden className="hover:bg-transparent border-0">
                <TableCell
                  colSpan={visibleColumnCount}
                  style={{ height: paddingBottom, padding: 0 }}
                />
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {dashboard.hasMore && (
        <div ref={sentinelRef} className="py-6 text-center text-neutral-500 dark:text-neutral-400 text-sm">
          {dashboard.isLoadingMore ? "Загрузка…" : "Прокрутите для следующих элементов"}
        </div>
      )}
    </>
  );
}
