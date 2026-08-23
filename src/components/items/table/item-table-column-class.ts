import { columnWidthClass } from "./column-width.ts";

function joinClasses(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

export function itemTableHeaderClassName(columnId: string): string {
  return joinClasses(
    "px-3",
    columnWidthClass(columnId),
    columnId === "actions" ? "text-right" : undefined,
    columnId === "select" ? "px-2" : undefined,
  );
}

export function itemTableCellClassName(columnId: string): string {
  return joinClasses(
    "overflow-hidden px-3 py-2",
    columnWidthClass(columnId),
    columnId === "actions" ? "text-right" : undefined,
    columnId === "select" ? "px-2" : undefined,
    columnId === "tags" ? "whitespace-normal" : undefined,
    columnId === "title" ? "whitespace-normal" : undefined,
  );
}
