import { RECONCILE_TOUCH_FILE } from "./paths.js";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Map a path under vault `items/` to the affected item id, if any. */
export function parseVaultItemsWatchItemId(
  itemsDir: string,
  changedPath: string,
): string | null {
  const normalizedItems = normalizePath(itemsDir);
  const normalized = normalizePath(changedPath);
  if (normalized === normalizedItems) {
    return null;
  }

  const prefix = `${normalizedItems}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }

  const itemId = normalized.slice(prefix.length).split("/")[0] ?? "";
  if (!itemId || itemId === RECONCILE_TOUCH_FILE) {
    return null;
  }
  return itemId;
}
