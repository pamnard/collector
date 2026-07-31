import { Columns3 } from "lucide-react";
import type { Table, VisibilityState } from "@tanstack/react-table";
import type { ItemFile } from "@collector/shared";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { ITEM_TABLE_COLUMN_SPECS } from "./item-table-column-specs";

interface ItemTableToolbarProps {
  selectedCount: number;
  totalCount: number;
  showSelectAllMatching: boolean;
  onSelectAllMatching: () => void;
  table: Table<ItemFile>;
  columnVisibility: VisibilityState;
}

export function ItemTableToolbar({
  selectedCount,
  totalCount,
  showSelectAllMatching,
  onSelectAllMatching,
  table,
  columnVisibility,
}: ItemTableToolbarProps) {
  const hideableSpecs = ITEM_TABLE_COLUMN_SPECS.filter(
    (spec) => spec.enableHiding,
  );

  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="min-h-7 flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-300">
        {selectedCount > 0 ? (
          <>
            <span>Выбрано {selectedCount}</span>
            {showSelectAllMatching ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={onSelectAllMatching}
              >
                Выбрать все {totalCount}
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
  );
}
