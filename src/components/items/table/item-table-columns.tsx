import type { SyntheticEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { DashboardItemSort } from "@collector/api";
import type { TagWithCount } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { ItemRowActions } from "../ItemRowActions";
import { ItemTagBadges } from "../ItemTagBadges";
import { formatItemDate } from "../../../utils/formatItemDate";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { cn } from "../../../lib/utils";
import type { LoadedSelectionState } from "./dashboard-table-selection";
import {
  ITEM_TABLE_COLUMN_SPECS,
  isColumnSortable,
  nextDashboardSort,
} from "./item-table-column-specs";

export interface ItemTableSelectionColumnDeps {
  loadedState: LoadedSelectionState;
  isRowSelected: (id: string) => boolean;
  onToggleRow: (id: string) => void;
  onSetLoadedSelected: (select: boolean) => void;
}

export interface ItemTableSortColumnDeps {
  sort: DashboardItemSort;
  onSortChange: (sort: DashboardItemSort) => void;
}

export interface ItemTableColumnDeps {
  tagsById: Map<string, TagWithCount>;
  onUpdated: () => void;
  selection: ItemTableSelectionColumnDeps;
  sort: ItemTableSortColumnDeps;
}

function stopRowNavigation(event: SyntheticEvent) {
  event.stopPropagation();
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSortChange,
}: {
  label: string;
  sortKey: string;
  sort: DashboardItemSort;
  onSortChange: (sort: DashboardItemSort) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "-ml-2 h-8 gap-1 px-2 font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
        active && "text-neutral-900 dark:text-neutral-100",
      )}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      onClick={(event) => {
        stopRowNavigation(event);
        onSortChange(nextDashboardSort(sort, sortKey));
      }}
    >
      {label}
      <Icon size={14} className="opacity-70" aria-hidden />
    </Button>
  );
}

function headerForSpec(
  spec: (typeof ITEM_TABLE_COLUMN_SPECS)[number],
  sort: ItemTableSortColumnDeps,
): ColumnDef<ItemFile>["header"] {
  if (isColumnSortable(spec) && spec.sortKey) {
    return () => (
      <SortableHeader
        label={spec.label}
        sortKey={spec.sortKey!}
        sort={sort.sort}
        onSortChange={sort.onSortChange}
      />
    );
  }
  return spec.label;
}

export function createItemTableColumns({
  tagsById,
  onUpdated,
  selection,
  sort,
}: ItemTableColumnDeps): ColumnDef<ItemFile>[] {
  const byId = new Map(ITEM_TABLE_COLUMN_SPECS.map((spec) => [spec.id, spec]));

  return [
    {
      id: "select",
      header: () => (
        <div
          className="flex items-center justify-center"
          onClick={stopRowNavigation}
          onKeyDown={stopRowNavigation}
        >
          <Checkbox
            checked={selection.loadedState === "all"}
            indeterminate={selection.loadedState === "some"}
            aria-label="Выбрать все загруженные"
            onCheckedChange={(checked) => {
              selection.onSetLoadedSelected(checked === true);
            }}
          />
        </div>
      ),
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.id;
        return (
          <div
            className="flex items-center justify-center"
            onClick={stopRowNavigation}
            onKeyDown={stopRowNavigation}
          >
            <Checkbox
              checked={selection.isRowSelected(id)}
              aria-label="Выбрать элемент"
              onCheckedChange={() => {
                selection.onToggleRow(id);
              }}
            />
          </div>
        );
      },
    },
    {
      id: "title",
      accessorKey: "title",
      header: headerForSpec(byId.get("title")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("title")!),
      cell: ({ row }) => (
        <p className="truncate font-medium">{row.original.title}</p>
      ),
    },
    {
      id: "created_at",
      accessorKey: "created_at",
      header: headerForSpec(byId.get("created_at")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("created_at")!),
      cell: ({ row }) => (
        <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
          {formatItemDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "content_type",
      accessorKey: "content_type",
      header: headerForSpec(byId.get("content_type")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("content_type")!),
      cell: ({ row }) => (
        <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
          {row.original.content_type}
        </span>
      ),
    },
    {
      id: "tags",
      header: headerForSpec(byId.get("tags")!, sort),
      enableHiding: true,
      enableSorting: false,
      cell: ({ row }) => (
        <ItemTagBadges tagIds={row.original.tag_ids} tagsById={tagsById} />
      ),
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      header: headerForSpec(byId.get("updated_at")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("updated_at")!),
      cell: ({ row }) => (
        <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
          {formatItemDate(row.original.updated_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Действия</span>,
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <ItemRowActions
          itemId={row.original.id}
          itemTitle={row.original.title}
          onUpdated={onUpdated}
        />
      ),
    },
  ];
}
