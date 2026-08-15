import type { ContentType, ItemFile, SourceType } from "@collector/shared";
import type { SqlExecutor } from "@collector/db";
import type { ItemIdPageOptions } from "../adapters/types.js";

export interface SqlIndexSelector extends SqlExecutor {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

export interface ItemRow {
  id: string;
  vault_id: string;
  title: string;
  description: string;
  url: string | null;
  content_type: string;
  source_type: string;
  source_id: string | null;
  metadata_json: string;
  properties_json: string;
  thumbnail_path: string | null;
  folder_path: string;
  content_revision: number;
  created_at: string;
  updated_at: string;
}

export function serializeMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

export function parseMetadata(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid item metadata_json: expected object, got ${typeof parsed}`);
  }
  return parsed as Record<string, unknown>;
}

export function serializeProperties(properties: Record<string, unknown>): string {
  return JSON.stringify(properties);
}

export function parseProperties(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid item properties_json: expected object, got ${typeof parsed}`);
  }
  return parsed as Record<string, unknown>;
}

export function itemRowToFile(
  row: ItemRow,
  tagIds: string[],
  collectionIds: string[],
): ItemFile {
  return {
    id: row.id,
    vault_id: row.vault_id,
    title: row.title,
    description: row.description,
    url: row.url ?? undefined,
    content_type: row.content_type as ContentType,
    source_type: row.source_type as SourceType,
    source_id: row.source_id ?? undefined,
    metadata: parseMetadata(row.metadata_json),
    properties: parseProperties(row.properties_json),
    thumbnail: row.thumbnail_path ?? undefined,
    tag_ids: tagIds,
    collection_ids: collectionIds,
    folder_path: row.folder_path ?? "",
    content_revision: row.content_revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function sqlInPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** SQLite bind limit is 999; keep multi-row inserts well under that. */
export const SQL_INSERT_CHUNK = 100;

/**
 * Max ids per `IN (...)` select. Stay in the 200–500 band (#666) and leave
 * headroom under SQLITE_MAX_VARIABLE_NUMBER for extras like `vault_id`.
 */
export const SQL_IN_LIST_CHUNK = 400;

/**
 * Hard ceiling for id IN-lists. Fail fast with a clear error — never silently
 * truncate required rows (#666).
 */
export const SQL_IN_LIST_MAX = 100_000;

export function assertSqlInListSize(count: number, label: string): void {
  if (count > SQL_IN_LIST_MAX) {
    throw new Error(
      `${label}: id list length ${count} exceeds max ${SQL_IN_LIST_MAX}`,
    );
  }
}

/** Split ids into SQL_IN_LIST_CHUNK slices; concatenation preserves order. */
export function chunkSqlInList<T>(ids: readonly T[]): T[][] {
  if (ids.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let offset = 0; offset < ids.length; offset += SQL_IN_LIST_CHUNK) {
    chunks.push(ids.slice(offset, offset + SQL_IN_LIST_CHUNK) as T[]);
  }
  return chunks;
}

export function sqlRowPlaceholders(rowCount: number, columnsPerRow: number): string {
  const oneRow = `(${sqlInPlaceholders(columnsPerRow)})`;
  return Array.from({ length: rowCount }, () => oneRow).join(", ");
}

export function sqlCollectionStubPlaceholders(rowCount: number): string {
  const oneRow = "(?, ?, NULL, ?, '', ?, ?)";
  return Array.from({ length: rowCount }, () => oneRow).join(", ");
}

export async function replaceItemTags(
  db: SqlExecutor,
  itemId: string,
  tagIds: string[],
): Promise<void> {
  await db.execute("DELETE FROM item_tags WHERE item_id = ?", [itemId]);
  if (tagIds.length === 0) {
    return;
  }
  for (let offset = 0; offset < tagIds.length; offset += SQL_INSERT_CHUNK) {
    const chunk = tagIds.slice(offset, offset + SQL_INSERT_CHUNK);
    const binds: unknown[] = [];
    for (const tagId of chunk) {
      binds.push(itemId, tagId);
    }
    await db.execute(
      `INSERT INTO item_tags (item_id, tag_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
      binds,
    );
  }
}

export async function replaceItemCollections(
  db: SqlExecutor,
  itemId: string,
  vaultId: string,
  collectionIds: string[],
  createdAt: string,
  updatedAt: string,
): Promise<void> {
  await db.execute("DELETE FROM item_collections WHERE item_id = ?", [itemId]);
  if (collectionIds.length === 0) {
    return;
  }
  for (let offset = 0; offset < collectionIds.length; offset += SQL_INSERT_CHUNK) {
    const chunk = collectionIds.slice(offset, offset + SQL_INSERT_CHUNK);
    const stubBinds: unknown[] = [];
    for (const collectionId of chunk) {
      stubBinds.push(
        collectionId,
        vaultId,
        collectionId,
        createdAt,
        updatedAt,
      );
    }
    // Stub parents so FK on item_collections succeeds without collections sync.
    await db.execute(
      `INSERT INTO collections (
        id, vault_id, parent_id, name, description, created_at, updated_at
      ) VALUES ${sqlCollectionStubPlaceholders(chunk.length)}
      ON CONFLICT(id) DO NOTHING`,
      stubBinds,
    );
    const linkBinds: unknown[] = [];
    for (const collectionId of chunk) {
      linkBinds.push(itemId, collectionId);
    }
    await db.execute(
      `INSERT INTO item_collections (item_id, collection_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
      linkBinds,
    );
  }
}

export function sqlPageClause(options?: ItemIdPageOptions): {
  sql: string;
  binds: number[];
} {
  if (options?.limit === undefined) {
    return { sql: "", binds: [] };
  }
  const binds = [options.limit];
  let sql = "LIMIT ?";
  if (options.offset !== undefined) {
    sql += " OFFSET ?";
    binds.push(options.offset);
  }
  return { sql, binds };
}
