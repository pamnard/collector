export interface ColumnVisibilitySpec {
  id: string;
  defaultVisible: boolean;
  enableHiding: boolean;
}

/** Resolve persisted visibility against the column registry. Unknown stored ids are ignored. */
export function resolveColumnVisibility(
  columns: readonly ColumnVisibilitySpec[],
  stored: Record<string, boolean>,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const col of columns) {
    if (!col.enableHiding) {
      result[col.id] = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(stored, col.id)) {
      result[col.id] = stored[col.id]!;
    } else {
      result[col.id] = col.defaultVisible;
    }
  }
  return result;
}
