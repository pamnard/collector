import type { ColumnDef } from "@tanstack/react-table";
import type { TagWithCount } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import {
  ItemTableActionsCell,
  ItemTableContentTypeCell,
  ItemTableDateCell,
  ItemTableTagsCell,
  ItemTableTitleCell,
} from "./item-table-cells";
import {
  ITEM_TABLE_COLUMN_SPECS,
  isColumnSortable,
} from "./item-table-column-specs";
import {
  headerForSpec,
  type ItemTableSortColumnDeps,
} from "./item-table-sortable-header";
import {
  createItemTableSelectColumn,
  type ItemTableSelectionColumnDeps,
} from "./item-table-select-column";

export type { ItemTableSortColumnDeps, ItemTableSelectionColumnDeps };

export interface ItemTableColumnDeps {
  tagsById: Map<string, TagWithCount>;
  onUpdated?: () => void;
  selection: ItemTableSelectionColumnDeps;
  sort: ItemTableSortColumnDeps;
}

export function createItemTableColumns({
  tagsById,
  onUpdated,
  selection,
  sort,
}: ItemTableColumnDeps): ColumnDef<ItemFile>[] {
  const byId = new Map(ITEM_TABLE_COLUMN_SPECS.map((spec) => [spec.id, spec]));

  return [
    createItemTableSelectColumn(selection),
    {
      id: "title",
      accessorKey: "title",
      header: headerForSpec(byId.get("title")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("title")!),
      cell: ({ row }) => <ItemTableTitleCell item={row.original} />,
    },
    {
      id: "created_at",
      accessorKey: "created_at",
      header: headerForSpec(byId.get("created_at")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("created_at")!),
      cell: ({ row }) => (
        <ItemTableDateCell value={row.original.created_at} />
      ),
    },
    {
      id: "content_type",
      accessorKey: "content_type",
      header: headerForSpec(byId.get("content_type")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("content_type")!),
      cell: ({ row }) => <ItemTableContentTypeCell item={row.original} />,
    },
    {
      id: "tags",
      header: headerForSpec(byId.get("tags")!, sort),
      enableHiding: true,
      enableSorting: false,
      cell: ({ row }) => (
        <ItemTableTagsCell item={row.original} tagsById={tagsById} />
      ),
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      header: headerForSpec(byId.get("updated_at")!, sort),
      enableHiding: true,
      enableSorting: isColumnSortable(byId.get("updated_at")!),
      cell: ({ row }) => (
        <ItemTableDateCell value={row.original.updated_at} />
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Действия</span>,
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <ItemTableActionsCell item={row.original} onUpdated={onUpdated} />
      ),
    },
  ];
}
