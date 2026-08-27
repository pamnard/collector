/** Allowlisted sort keys for dashboard / listItemIds* ORDER BY (#339). */

export type ItemIdSortDir = "asc" | "desc";

export interface ItemIdSort {
  key: string;
  dir: ItemIdSortDir;
}

export const DEFAULT_ITEM_ID_SORT: ItemIdSort = {
  key: "created_at",
  dir: "desc",
};

/** Safe SQL expressions only — never interpolate caller strings into ORDER BY. */
const ITEM_ID_SORT_SQL: Readonly<Record<string, string>> = {
  title: "i.title COLLATE NOCASE",
  created_at: "i.created_at",
  updated_at: "i.updated_at",
  content_type: "i.content_type",
  word_count: "i.word_count",
  character_count: "i.character_count",
};

export const ITEM_ID_SORT_KEYS: readonly string[] = Object.freeze(
  Object.keys(ITEM_ID_SORT_SQL),
);

export function isItemIdSortKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEM_ID_SORT_SQL, key);
}

export function isItemIdSortDir(dir: string): dir is ItemIdSortDir {
  return dir === "asc" || dir === "desc";
}

/** Primary sort direction when activating a new column in the UI. */
export function primarySortDirForKey(key: string): ItemIdSortDir {
  if (
    key === "created_at" ||
    key === "updated_at" ||
    key === "word_count" ||
    key === "character_count"
  ) {
    return "desc";
  }
  return "asc";
}

/**
 * Resolves `ORDER BY …` for listItemIds* queries.
 * Unknown key or dir throws (never interpolates raw input into SQL).
 */
export function resolveItemIdOrderByClause(sort?: ItemIdSort | null): string {
  const resolved = sort ?? DEFAULT_ITEM_ID_SORT;
  const expr = ITEM_ID_SORT_SQL[resolved.key];
  if (expr === undefined) {
    throw new Error(`Unsupported item id sort key: ${resolved.key}`);
  }
  if (!isItemIdSortDir(resolved.dir)) {
    throw new Error(`Unsupported item id sort dir: ${String(resolved.dir)}`);
  }
  const dirSql = resolved.dir === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${expr} ${dirSql}, i.id ASC`;
}
