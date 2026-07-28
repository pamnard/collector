import type { DashboardItemSort } from "@collector/api";
import {
  isItemIdSortKey,
  primarySortDirForKey,
} from "@collector/core";
import type { ColumnVisibilitySpec } from "./resolve-column-visibility";

export interface ItemTableColumnSpec extends ColumnVisibilitySpec {
  label: string;
  /** Server-side sort key; must also be allowlisted in core (#339). */
  sortKey?: string;
}

export const ITEM_TABLE_COLUMN_SPECS: readonly ItemTableColumnSpec[] = [
  {
    id: "title",
    label: "Название",
    defaultVisible: true,
    enableHiding: true,
    sortKey: "title",
  },
  {
    id: "created_at",
    label: "Создано",
    defaultVisible: true,
    enableHiding: true,
    sortKey: "created_at",
  },
  {
    id: "content_type",
    label: "Тип",
    defaultVisible: false,
    enableHiding: true,
    sortKey: "content_type",
  },
  {
    id: "tags",
    label: "Теги",
    defaultVisible: false,
    enableHiding: true,
  },
  {
    id: "updated_at",
    label: "Обновлено",
    defaultVisible: false,
    enableHiding: true,
    sortKey: "updated_at",
  },
  {
    id: "actions",
    label: "Действия",
    defaultVisible: true,
    enableHiding: false,
  },
] as const;

export function isColumnSortable(spec: ItemTableColumnSpec): boolean {
  return spec.sortKey !== undefined && isItemIdSortKey(spec.sortKey);
}

/** Toggle same column; activate another with its primary direction. */
export function nextDashboardSort(
  current: DashboardItemSort,
  sortKey: string,
): DashboardItemSort {
  if (!isItemIdSortKey(sortKey)) {
    return current;
  }
  if (current.key === sortKey) {
    return {
      key: sortKey,
      dir: current.dir === "asc" ? "desc" : "asc",
    };
  }
  return { key: sortKey, dir: primarySortDirForKey(sortKey) };
}
