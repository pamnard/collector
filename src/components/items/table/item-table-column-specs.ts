import type { ColumnVisibilitySpec } from "./resolve-column-visibility";

export interface ItemTableColumnSpec extends ColumnVisibilitySpec {
  label: string;
  /** Reserved for server-side sort (#339); unused in this slice. */
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
