import { cn } from "../../../lib/utils.ts";
import { columnWidthClass } from "./column-width.ts";

export function itemTableHeaderClassName(columnId: string): string {
  return cn(
    "px-3",
    columnWidthClass(columnId),
    columnId === "actions" && "text-right",
    columnId === "select" && "px-2",
  );
}

export function itemTableCellClassName(columnId: string): string {
  return cn(
    "overflow-hidden px-3 py-2",
    columnWidthClass(columnId),
    columnId === "actions" && "text-right",
    columnId === "select" && "px-2",
    columnId === "tags" && "whitespace-normal",
    columnId === "title" && "whitespace-normal",
  );
}
