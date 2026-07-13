import type { MediaFileMeta, Tag, VaultMeta } from "@collector/shared";
import type { SqlExecutor } from "@collector/db";
import type { IndexedItem, VaultIndexAdapter } from "../adapters/types.js";
import type { NavSearchFilter } from "../search/nav-filter.js";
import { isFolderFilter, isTagFilter } from "../search/nav-filter.js";

type TagWithCount = Tag & { item_count: number };

function serializeMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

function navFilterClause(filter: NavSearchFilter): string {
  if (isTagFilter(filter) || isFolderFilter(filter)) {
    return "AND i.is_archived = 0";
  }

  switch (filter) {
    case "favorite":
      return "AND i.is_favorite = 1";
    case "archived":
      return "AND i.is_archived = 1";
    case "all":
    default:
      return "AND i.is_archived = 0";
  }
}

export class SqlVaultIndexAdapter implements VaultIndexAdapter {
  constructor(private readonly db: SqlExecutor) {}

  async upsertVault(meta: VaultMeta, vaultPath: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO vaults (
        id, path, name, description, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        description = excluded.description,
        is_default = excluded.is_default,
        updated_at = excluded.updated_at`,
      [
        meta.id,
        vaultPath,
        meta.name,
        meta.description,
        meta.is_default ? 1 : 0,
        meta.created_at,
        meta.updated_at,
      ],
    );
  }

  async deleteVault(vaultId: string): Promise<void> {
    await this.db.execute("DELETE FROM vaults WHERE id = ?", [vaultId]);
  }

  async upsertItem(record: IndexedItem, vaultId: string): Promise<void> {
    const { item, content, sourceRef } = record;

    await this.db.execute(
      `INSERT INTO items (
        id, vault_id, title, description, url, content_type, source_type, source_id,
        metadata_json, thumbnail_path, is_archived, is_favorite, has_content_file,
        folder_path, created_at, updated_at, file_mtime_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vault_id = excluded.vault_id,
        title = excluded.title,
        description = excluded.description,
        url = excluded.url,
        content_type = excluded.content_type,
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        metadata_json = excluded.metadata_json,
        thumbnail_path = excluded.thumbnail_path,
        is_archived = excluded.is_archived,
        is_favorite = excluded.is_favorite,
        has_content_file = excluded.has_content_file,
        folder_path = excluded.folder_path,
        updated_at = excluded.updated_at,
        file_mtime_ms = excluded.file_mtime_ms`,
      [
        item.id,
        vaultId,
        item.title,
        item.description,
        item.url ?? null,
        item.content_type,
        item.source_type,
        item.source_id ?? null,
        serializeMetadata(item.metadata),
        item.thumbnail ?? null,
        item.is_archived ? 1 : 0,
        item.is_favorite ? 1 : 0,
        content ? 1 : 0,
        item.folder_path ?? "",
        item.created_at,
        item.updated_at,
        record.fileMtimeMs ?? 0,
      ],
    );

    await this.db.execute("DELETE FROM item_tags WHERE item_id = ?", [item.id]);
    for (const tagId of item.tag_ids) {
      await this.db.execute(
        "INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)",
        [item.id, tagId],
      );
    }

    await this.db.execute("DELETE FROM item_collections WHERE item_id = ?", [item.id]);
    for (const collectionId of item.collection_ids) {
      await this.db.execute(
        `INSERT INTO item_collections (item_id, collection_id)
         SELECT ?, ?
         WHERE EXISTS (SELECT 1 FROM collections WHERE id = ?)`,
        [item.id, collectionId, collectionId],
      );
    }

    await this.db.execute("DELETE FROM items_fts WHERE item_id = ?", [item.id]);
    await this.db.execute(
      "INSERT INTO items_fts (item_id, title, description, content) VALUES (?, ?, ?, ?)",
      [item.id, item.title, item.description, content ?? ""],
    );

    if (sourceRef) {
      await this.db.execute("DELETE FROM source_refs WHERE item_id = ?", [item.id]);
      await this.db.execute(
        "DELETE FROM source_refs WHERE plugin_id = ? AND external_id = ?",
        [sourceRef.plugin_id, sourceRef.external_id],
      );
      await this.db.execute(
        `INSERT INTO source_refs (
          id, item_id, plugin_id, external_id, synced_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          item.id,
          sourceRef.plugin_id,
          sourceRef.external_id,
          sourceRef.synced_at ?? null,
          serializeMetadata(sourceRef.metadata ?? {}),
        ],
      );
    }
  }

  async upsertMedia(media: MediaFileMeta): Promise<void> {
    await this.db.execute(
      `INSERT INTO media (id, item_id, filename, media_type, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         item_id = excluded.item_id,
         filename = excluded.filename,
         media_type = excluded.media_type,
         created_at = excluded.created_at`,
      [media.id, media.item_id, media.filename, media.media_type, media.created_at],
    );
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.db.execute("DELETE FROM media WHERE id = ?", [mediaId]);
  }

  async deleteMediaForItem(itemId: string): Promise<void> {
    await this.db.execute("DELETE FROM media WHERE item_id = ?", [itemId]);
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.db.execute("DELETE FROM media WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM source_refs WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM items_fts WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM items WHERE id = ?", [itemId]);
  }

  async upsertTag(tag: Tag, vaultId: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO tags (id, vault_id, name, color, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         color = excluded.color`,
      [tag.id, vaultId, tag.name, tag.color ?? null, tag.created_at],
    );
  }

  async deleteTag(tagId: string): Promise<void> {
    await this.db.execute("DELETE FROM item_tags WHERE tag_id = ?", [tagId]);
    await this.db.execute("DELETE FROM tags WHERE id = ?", [tagId]);
  }

  async listTagsWithCounts(_vaultId: string): Promise<TagWithCount[]> {
    throw new Error(
      "listTagsWithCounts requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemIdsByTag(_vaultId: string, _tagId: string): Promise<string[]> {
    throw new Error(
      "listItemIdsByTag requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemIdsByFolderPrefix(
    _vaultId: string,
    _folderPath: string,
  ): Promise<string[]> {
    throw new Error(
      "listItemIdsByFolderPrefix requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemIdsByNavFilter(
    _vaultId: string,
    _filter: NavSearchFilter,
  ): Promise<string[]> {
    throw new Error(
      "listItemIdsByNavFilter requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listFolderItemCounts(_vaultId: string): Promise<
    Array<{ folder_path: string; item_count: number }>
  > {
    throw new Error(
      "listFolderItemCounts requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listVaultItemIds(_vaultId: string): Promise<string[]> {
    throw new Error(
      "listVaultItemIds requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listVaultItemTimestamps(_vaultId: string): Promise<Array<{ id: string; file_mtime_ms: number }>> {
    throw new Error(
      "listVaultItemTimestamps requires select(); use SqlVaultIndexStore instead",
    );
  }

  async searchItemIds(
    _vaultId: string,
    _ftsQuery: string,
    _filter: NavSearchFilter,
    _limit?: number,
  ): Promise<string[]> {
    throw new Error(
      "searchItemIds requires select(); use SqlVaultIndexStore instead",
    );
  }
}

export interface SqlSelectRow {
  id: string;
}

export interface SqlSelector {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

export class SqlVaultIndexStore extends SqlVaultIndexAdapter {
  constructor(private readonly selector: SqlSelector & SqlExecutor) {
    super(selector);
  }

  override async listVaultItemIds(vaultId: string): Promise<string[]> {
    const rows = await this.selector.select<SqlSelectRow>(
      "SELECT id FROM items WHERE vault_id = ?",
      [vaultId],
    );
    return rows.map((row) => row.id);
  }

  override async listVaultItemTimestamps(
    vaultId: string,
  ): Promise<Array<{ id: string; file_mtime_ms: number }>> {
    const rows = await this.selector.select<{ id: string; file_mtime_ms: number }>(
      "SELECT id, file_mtime_ms FROM items WHERE vault_id = ?",
      [vaultId],
    );
    return rows;
  }

  override async searchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavSearchFilter,
    limit = 200,
  ): Promise<string[]> {
    let extraJoin = "";
    const extraBinds: unknown[] = [];

    if (isTagFilter(filter)) {
      extraJoin = "INNER JOIN item_tags it ON it.item_id = i.id AND it.tag_id = ?";
      extraBinds.push(filter.tagId);
    }

    let folderClause = "";
    if (isFolderFilter(filter)) {
      folderClause = "AND (i.folder_path = ? OR i.folder_path LIKE ?)";
      extraBinds.push(filter.folderPath, `${filter.folderPath}/%`);
    }

    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items_fts
       INNER JOIN items i ON i.id = items_fts.item_id
       ${extraJoin}
       WHERE items_fts MATCH ?
         AND i.vault_id = ?
         ${navFilterClause(filter)}
         ${folderClause}
       ORDER BY rank
       LIMIT ?`,
      [...extraBinds, ftsQuery, vaultId, limit],
    );
    return rows.map((row) => row.id);
  }

  override async listTagsWithCounts(vaultId: string): Promise<TagWithCount[]> {
    const rows = await this.selector.select<{
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

  override async listItemIdsByTag(vaultId: string, tagId: string): Promise<string[]> {
    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items i
       INNER JOIN item_tags it ON it.item_id = i.id
       WHERE i.vault_id = ?
         AND it.tag_id = ?
         AND i.is_archived = 0
       ORDER BY i.created_at DESC`,
      [vaultId, tagId],
    );
    return rows.map((row) => row.id);
  }

  override async listItemIdsByFolderPrefix(
    vaultId: string,
    folderPath: string,
  ): Promise<string[]> {
    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items i
       WHERE i.vault_id = ?
         AND i.is_archived = 0
         AND (i.folder_path = ? OR i.folder_path LIKE ?)
       ORDER BY i.created_at DESC`,
      [vaultId, folderPath, `${folderPath}/%`],
    );
    return rows.map((row) => row.id);
  }

  override async listItemIdsByNavFilter(
    vaultId: string,
    filter: NavSearchFilter,
  ): Promise<string[]> {
    if (isTagFilter(filter)) {
      return this.listItemIdsByTag(vaultId, filter.tagId);
    }
    if (isFolderFilter(filter)) {
      return this.listItemIdsByFolderPrefix(vaultId, filter.folderPath);
    }

    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items i
       WHERE i.vault_id = ?
         ${navFilterClause(filter)}
       ORDER BY i.created_at DESC`,
      [vaultId],
    );
    return rows.map((row) => row.id);
  }

  override async listFolderItemCounts(
    vaultId: string,
  ): Promise<Array<{ folder_path: string; item_count: number }>> {
    const rows = await this.selector.select<{
      folder_path: string;
      item_count: number;
    }>(
      `SELECT folder_path, COUNT(*) AS item_count
       FROM items
       WHERE vault_id = ? AND is_archived = 0
       GROUP BY folder_path`,
      [vaultId],
    );
    return rows;
  }
}
