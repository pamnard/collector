import type { ColumnDef } from "@tanstack/react-table";
import type { ItemFile } from "@collector/shared";
import { Checkbox } from "../../ui/checkbox";
import type { LoadedSelectionState } from "./dashboard-table-selection";
import { stopRowNavigation } from "./item-table-sortable-header";

export interface ItemTableSelectionColumnDeps {
  loadedState: LoadedSelectionState;
  isRowSelected: (id: string) => boolean;
  onToggleRow: (id: string) => void;
  onSetLoadedSelected: (select: boolean) => void;
}

export function createItemTableSelectColumn(
  selection: ItemTableSelectionColumnDeps,
): ColumnDef<ItemFile> {
  return {
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
  };
}
