import type { ColumnDef } from "@tanstack/react-table";
import type { TagWithCount } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { ItemRowActions } from "../ItemRowActions";
import { ItemTagBadges } from "../ItemTagBadges";
import { formatItemDate } from "../../../utils/formatItemDate";
import { Checkbox } from "../../ui/checkbox";
import type { LoadedSelectionState } from "./dashboard-table-selection";
import {
  ITEM_TABLE_COLUMN_SPECS,
  isColumnSortable,
} from "./item-table-column-specs";
import {
  headerForSpec,
  stopRowNavigation,
  type ItemTableSortColumnDeps,
} from "./item-table-sortable-header";

export type { ItemTableSortColumnDeps };

export interface ItemTableSelectionColumnDeps {
  loadedState: LoadedSelectionState;
  isRowSelected: (id: string) => boolean;
  onToggleRow: (id: string) => void;
  onSetLoadedSelected: (select: boolean) => void;
}

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
