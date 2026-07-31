import type { SyntheticEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { DashboardItemSort } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import {
  ITEM_TABLE_COLUMN_SPECS,
  isColumnSortable,
  nextDashboardSort,
} from "./item-table-column-specs";

export interface ItemTableSortColumnDeps {
  sort: DashboardItemSort;
  onSortChange: (sort: DashboardItemSort) => void;
}

export function stopRowNavigation(event: SyntheticEvent) {
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

export function headerForSpec(
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
