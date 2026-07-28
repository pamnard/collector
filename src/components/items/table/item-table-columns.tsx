import type { ColumnDef } from "@tanstack/react-table";
import type { TagWithCount } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { ItemRowActions } from "../ItemRowActions";
import { ItemTagBadges } from "../ItemTagBadges";
import { formatItemDate } from "../../../utils/formatItemDate";

export interface ItemTableColumnDeps {
  tagsById: Map<string, TagWithCount>;
  onUpdated: () => void;
}

export function createItemTableColumns({
  tagsById,
  onUpdated,
}: ItemTableColumnDeps): ColumnDef<ItemFile>[] {
  return [
    {
      id: "title",
      accessorKey: "title",
      header: "Название",
      enableHiding: true,
      cell: ({ row }) => (
        <p className="truncate font-medium">{row.original.title}</p>
      ),
    },
    {
      id: "created_at",
      accessorKey: "created_at",
      header: "Создано",
      enableHiding: true,
      cell: ({ row }) => (
        <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
          {formatItemDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "content_type",
      accessorKey: "content_type",
      header: "Тип",
      enableHiding: true,
      cell: ({ row }) => (
        <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
          {row.original.content_type}
        </span>
      ),
    },
    {
      id: "tags",
      header: "Теги",
      enableHiding: true,
      enableSorting: false,
      cell: ({ row }) => (
        <ItemTagBadges tagIds={row.original.tag_ids} tagsById={tagsById} />
      ),
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      header: "Обновлено",
      enableHiding: true,
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
        <ItemRowActions itemId={row.original.id} onUpdated={onUpdated} />
      ),
    },
  ];
}
