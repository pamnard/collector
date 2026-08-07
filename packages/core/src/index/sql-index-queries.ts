import type { ItemFile, Tag } from "@collector/shared";
import type {
  AdjacentItemAnchor,
  AdjacentItemsResult,
  ItemIdListOptions,
  ItemIdPageOptions,
  ReconcileFingerprint,
} from "../adapters/types.js";
import type { NavSearchFilter } from "../search/nav-filter.js";
import { isFolderFilter, isTagFilter } from "../search/nav-filter.js";
import { resolveItemIdOrderByClause } from "./item-id-sort.js";
import {
  itemRowToFile,
  sqlInPlaceholders,
  sqlPageClause,
  type ItemRow,
  type SqlIndexSelector,
} from "./sql-index-helpers.js";
import { parseStoredReconcileFingerprint } from "../vault/reconcile-fingerprint.js";

export interface SqlSelectRow {
  id: string;
}

type TagWithCount = Tag & { item_count: number };

function ftsFilterParts(filter: NavSearchFilter): {
  extraJoin: string;
  joinBinds: unknown[];
  folderClause: string;
  folderBinds: unknown[];
} {
  let extraJoin = "";
  const joinBinds: unknown[] = [];

  if (isTagFilter(filter)) {
    extraJoin =
      "INNER JOIN item_tags it ON it.item_id = i.id AND it.tag_id = ?";
    joinBinds.push(filter.tagId);
  }

  let folderClause = "";
  const folderBinds: unknown[] = [];
  if (isFolderFilter(filter)) {
    folderClause = "AND i.folder_path = ?";
    folderBinds.push(filter.folderPath);
  }

  return { extraJoin, joinBinds, folderClause, folderBinds };
}

export async function listVaultItemIds(
  selector: SqlIndexSelector,
  vaultId: string,
): Promise<string[]> {
  const rows = await selector.select<SqlSelectRow>(
    "SELECT id FROM items WHERE vault_id = ?",
    [vaultId],
  );
  return rows.map((row) => row.id);
}

export async function listItemFilesByIds(
  selector: SqlIndexSelector,
  vaultId: string,
  itemIds: string[],
): Promise<ItemFile[]> {
  if (itemIds.length === 0) {
    return [];
  }

  const placeholders = sqlInPlaceholders(itemIds.length);
  const rows = await selector.select<ItemRow>(
    `SELECT
       id, vault_id, title, description, url, content_type, source_type,
       source_id, metadata_json, properties_json, thumbnail_path,
       folder_path, content_revision, created_at, updated_at
     FROM items
     WHERE vault_id = ? AND id IN (${placeholders})`,
    [vaultId, ...itemIds],
  );

  const byId = new Map(rows.map((row) => [row.id, row]));
  const foundIds = itemIds.filter((id) => byId.has(id));
  if (foundIds.length === 0) {
    return [];
  }

  const foundPlaceholders = sqlInPlaceholders(foundIds.length);
  const tagRows = await selector.select<{
    item_id: string;
    tag_id: string;
  }>(
    `SELECT item_id, tag_id FROM item_tags WHERE item_id IN (${foundPlaceholders})`,
    foundIds,
  );
  const collectionRows = await selector.select<{
    item_id: string;
    collection_id: string;
  }>(
    `SELECT item_id, collection_id
     FROM item_collections
     WHERE item_id IN (${foundPlaceholders})`,
    foundIds,
  );

  const tagsByItem = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByItem.get(row.item_id) ?? [];
    list.push(row.tag_id);
    tagsByItem.set(row.item_id, list);
  }

  const collectionsByItem = new Map<string, string[]>();
  for (const row of collectionRows) {
    const list = collectionsByItem.get(row.item_id) ?? [];
    list.push(row.collection_id);
    collectionsByItem.set(row.item_id, list);
  }

  const result: ItemFile[] = [];
  for (const id of itemIds) {
    const row = byId.get(id);
    if (!row) {
      continue;
    }
    try {
      result.push(
        itemRowToFile(
          row,
          tagsByItem.get(id) ?? [],
          collectionsByItem.get(id) ?? [],
        ),
      );
    } catch {
      // Corrupt metadata_json (or other row shape): skip this id for this
      // response; row stays in DB until filesystem sync re-upserts it.
    }
  }
  return result;
}

export async function listVaultItemSyncMeta(
  selector: SqlIndexSelector,
  vaultId: string,
): Promise<
  Array<{
    id: string;
    file_mtime_ms: number | null;
    updated_at: string;
    content_revision: number;
    created_at: string;
  }>
> {
  const rows = await selector.select<{
    id: string;
    file_mtime_ms: number | null;
    updated_at: string;
    content_revision: number;
    created_at: string;
  }>(
    `SELECT id, file_mtime_ms, updated_at, content_revision, created_at
     FROM items WHERE vault_id = ?`,
    [vaultId],
  );
  return rows;
}

export async function listItemSyncMetaByIds(
  selector: SqlIndexSelector,
  vaultId: string,
  itemIds: string[],
): Promise<
  Array<{
    id: string;
    file_mtime_ms: number | null;
    updated_at: string;
    content_revision: number;
    created_at: string;
  }>
> {
  if (itemIds.length === 0) {
    return [];
  }
  const placeholders = sqlInPlaceholders(itemIds.length);
  return selector.select(
    `SELECT id, file_mtime_ms, updated_at, content_revision, created_at
     FROM items WHERE vault_id = ? AND id IN (${placeholders})`,
    [vaultId, ...itemIds],
  );
}

export async function getReconcileFingerprint(
  selector: SqlIndexSelector,
  vaultId: string,
): Promise<ReconcileFingerprint | null> {
  const rows = await selector.select<{
    reconcile_fingerprint_json: string | null;
  }>(
    `SELECT reconcile_fingerprint_json FROM vaults WHERE id = ?`,
    [vaultId],
  );
  if (rows.length === 0) {
    return null;
  }
  return parseStoredReconcileFingerprint(rows[0]!.reconcile_fingerprint_json);
}

export async function searchItemIds(
  selector: SqlIndexSelector,
  vaultId: string,
  ftsQuery: string,
  filter: NavSearchFilter,
  options?: ItemIdPageOptions,
): Promise<string[]> {
  const { extraJoin, joinBinds, folderClause, folderBinds } =
    ftsFilterParts(filter);
  const page = sqlPageClause(options);

  const rows = await selector.select<SqlSelectRow>(
    `SELECT i.id
     FROM items_fts
     INNER JOIN items i ON i.id = items_fts.item_id
     ${extraJoin}
     WHERE items_fts MATCH ?
       AND i.vault_id = ?
       ${folderClause}
     ORDER BY rank
     ${page.sql}`,
    [...joinBinds, ftsQuery, vaultId, ...folderBinds, ...page.binds],
  );
  return rows.map((row) => row.id);
}

export async function countSearchItemIds(
  selector: SqlIndexSelector,
  vaultId: string,
  ftsQuery: string,
  filter: NavSearchFilter,
): Promise<number> {
  const { extraJoin, joinBinds, folderClause, folderBinds } =
    ftsFilterParts(filter);

  const rows = await selector.select<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM items_fts
     INNER JOIN items i ON i.id = items_fts.item_id
     ${extraJoin}
     WHERE items_fts MATCH ?
       AND i.vault_id = ?
       ${folderClause}`,
    [...joinBinds, ftsQuery, vaultId, ...folderBinds],
  );
  return rows[0]?.count ?? 0;
}

export async function listTagsWithCounts(
  selector: SqlIndexSelector,
  vaultId: string,
): Promise<TagWithCount[]> {
  const rows = await selector.select<{
    id: string;
    name: string;
    color: string | null;
    created_at: string;
    item_count: number;
  }>(
    `SELECT t.id, t.name, t.color, t.created_at, COUNT(it.item_id) AS item_count
     FROM tags t
     LEFT JOIN item_tags it ON it.tag_id = t.id
     LEFT JOIN items i ON i.id = it.item_id AND i.vault_id = ?
     WHERE t.vault_id = ?
     GROUP BY t.id
     ORDER BY t.name COLLATE NOCASE`,
    [vaultId, vaultId],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
    item_count: row.item_count,
  }));
}

export async function listItemIdsByTag(
  selector: SqlIndexSelector,
  vaultId: string,
  tagId: string,
  options?: ItemIdListOptions,
): Promise<string[]> {
  const page = sqlPageClause(options);
  const orderBy = resolveItemIdOrderByClause(options?.sort);
  const rows = await selector.select<SqlSelectRow>(
    `SELECT i.id
     FROM items i
     INNER JOIN item_tags it ON it.item_id = i.id
     WHERE i.vault_id = ?
       AND it.tag_id = ?
     ${orderBy}
     ${page.sql}`,
    [vaultId, tagId, ...page.binds],
  );
  return rows.map((row) => row.id);
}

export async function listItemIdsByFolder(
  selector: SqlIndexSelector,
  vaultId: string,
  folderPath: string,
  options?: ItemIdListOptions,
): Promise<string[]> {
  const page = sqlPageClause(options);
  const orderBy = resolveItemIdOrderByClause(options?.sort);
  const rows = await selector.select<SqlSelectRow>(
    `SELECT i.id
     FROM items i
     WHERE i.vault_id = ?
       AND i.folder_path = ?
     ${orderBy}
     ${page.sql}`,
    [vaultId, folderPath, ...page.binds],
  );
  return rows.map((row) => row.id);
}

export async function listItemIdsByFolderPrefix(
  selector: SqlIndexSelector,
  vaultId: string,
  folderPath: string,
  options?: ItemIdListOptions,
): Promise<string[]> {
  const page = sqlPageClause(options);
  const orderBy = resolveItemIdOrderByClause(options?.sort);
  const rows = await selector.select<SqlSelectRow>(
    `SELECT i.id
     FROM items i
     WHERE i.vault_id = ?
       AND (i.folder_path = ? OR i.folder_path LIKE ?)
     ${orderBy}
     ${page.sql}`,
    [vaultId, folderPath, `${folderPath}/%`, ...page.binds],
  );
  return rows.map((row) => row.id);
}

export async function getAdjacentItems(
  selector: SqlIndexSelector,
  vaultId: string,
  anchor: AdjacentItemAnchor,
): Promise<AdjacentItemsResult> {
  const prevRows = await selector.select<{ id: string; title: string }>(
    `SELECT id, title
     FROM items
     WHERE vault_id = ?
       AND folder_path = ?
       AND (
         created_at < ?
         OR (created_at = ? AND id < ?)
       )
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [
      vaultId,
      anchor.folder_path,
      anchor.created_at,
      anchor.created_at,
      anchor.id,
    ],
  );
  const nextRows = await selector.select<{ id: string; title: string }>(
    `SELECT id, title
     FROM items
     WHERE vault_id = ?
       AND folder_path = ?
       AND (
         created_at > ?
         OR (created_at = ? AND id > ?)
       )
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [
      vaultId,
      anchor.folder_path,
      anchor.created_at,
      anchor.created_at,
      anchor.id,
    ],
  );
  const prev = prevRows[0];
  const next = nextRows[0];
  return {
    prev: prev ? { id: prev.id, title: prev.title } : null,
    next: next ? { id: next.id, title: next.title } : null,
  };
}

export async function listItemIdsByNavFilter(
  selector: SqlIndexSelector,
  vaultId: string,
  filter: NavSearchFilter,
  options?: ItemIdPageOptions,
): Promise<string[]> {
  if (isTagFilter(filter)) {
    return listItemIdsByTag(selector, vaultId, filter.tagId, options);
  }
  if (isFolderFilter(filter)) {
    return listItemIdsByFolder(
      selector,
      vaultId,
      filter.folderPath,
      options,
    );
  }

  const page = sqlPageClause(options);
  const orderBy = resolveItemIdOrderByClause(options?.sort);
  const rows = await selector.select<SqlSelectRow>(
    `SELECT i.id
     FROM items i
     WHERE i.vault_id = ?
     ${orderBy}
     ${page.sql}`,
    [vaultId, ...page.binds],
  );
  return rows.map((row) => row.id);
}

export async function countItemIdsByNavFilter(
  selector: SqlIndexSelector,
  vaultId: string,
  filter: NavSearchFilter,
): Promise<number> {
  if (isTagFilter(filter)) {
    const rows = await selector.select<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM items i
       INNER JOIN item_tags it ON it.item_id = i.id
       WHERE i.vault_id = ?
         AND it.tag_id = ?`,
      [vaultId, filter.tagId],
    );
    return rows[0]?.count ?? 0;
  }
  if (isFolderFilter(filter)) {
    const rows = await selector.select<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM items i
       WHERE i.vault_id = ?
         AND i.folder_path = ?`,
      [vaultId, filter.folderPath],
    );
    return rows[0]?.count ?? 0;
  }

  const rows = await selector.select<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM items i
     WHERE i.vault_id = ?`,
    [vaultId],
  );
  return rows[0]?.count ?? 0;
}

export async function listFolderItemCounts(
  selector: SqlIndexSelector,
  vaultId: string,
): Promise<Array<{ folder_path: string; item_count: number }>> {
  const rows = await selector.select<{
    folder_path: string;
    item_count: number;
  }>(
    `SELECT folder_path, COUNT(*) AS item_count
     FROM items
     WHERE vault_id = ?
     GROUP BY folder_path`,
    [vaultId],
  );
  return rows;
}
