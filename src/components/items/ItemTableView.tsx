import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from "@tanstack/react-table";
import type { TagWithCount } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { Columns3 } from "lucide-react";
import { DashboardTableSkeleton } from "./DashboardListSkeleton";
import { selectionQueryKey } from "./table/dashboard-table-selection";
import { ITEM_TABLE_COLUMN_SPECS } from "./table/item-table-column-specs";
import { createItemTableColumns } from "./table/item-table-columns";
import { resolveColumnVisibility } from "./table/resolve-column-visibility";
import { useDashboardTableSelection } from "./table/use-dashboard-table-selection";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useMainScrollElement } from "../../hooks/useMainScrollElement";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useShell } from "../layout/AppLayout";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import { getCollectorService } from "../../services/collector-client";
import { navFilterKey } from "../../types/ui";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { cn } from "../../lib/utils";

interface ItemTableViewProps {
  dashboard: ReturnType<typeof useDashboardItems>;
  onUpdated: () => void;
}

const ROW_ESTIMATE_PX = 40;
const ROW_OVERSCAN = 10;

function columnWidthClass(columnId: string): string {
  switch (columnId) {
    case "select":
      return "w-10";
    case "content_type":
      return "w-28";
    case "tags":
      return "w-40";
    case "created_at":
    case "updated_at":
      return "w-28";
    case "actions":
      return "w-16";
    default:
      return "";
  }
}

export function ItemTableView({ dashboard, onUpdated }: ItemTableViewProps) {
  const navigate = useNavigate();
  const { vaultRevision, activeFilter, dashboardSort, setDashboardSort } =
    useShell();
  const { settings, setTableColumnVisibility } = useAppSettings();
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

  useEffect(() => {
    void getCollectorService().tags.listTags().then(setTags);
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
  const hideableSpecs = ITEM_TABLE_COLUMN_SPECS.filter((spec) => spec.enableHiding);

  const virtualizer = useVirtualizer({
    count: rows.length,
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-h-7 flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-300">
          {selection.selectedCount > 0 ? (
            <>
              <span>Выбрано {selection.selectedCount}</span>
              {selection.showSelectAllMatching ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    selection.selectAllMatching();
                  }}
                >
                  Выбрать все {dashboard.totalCount}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
              />
            }
          >
            <Columns3 size={16} />
            Столбцы
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Видимые столбцы</DropdownMenuLabel>
              {hideableSpecs.map((spec) => (
                <DropdownMenuCheckboxItem
                  key={spec.id}
                  checked={columnVisibility[spec.id] !== false}
                  onCheckedChange={(checked) => {
                    table.getColumn(spec.id)?.toggleVisibility(!!checked);
                  }}
                >
                  {spec.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
                    className={cn(
                      "px-3",
                      columnWidthClass(header.column.id),
                      header.column.id === "actions" && "text-right",
                      header.column.id === "select" && "px-2",
                    )}
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
                      className={cn(
                        "overflow-hidden px-3 py-2",
                        columnWidthClass(cell.column.id),
                        cell.column.id === "actions" && "text-right",
                        cell.column.id === "select" && "px-2",
                        cell.column.id === "tags" && "whitespace-normal",
                        cell.column.id === "title" && "whitespace-normal",
                      )}
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
