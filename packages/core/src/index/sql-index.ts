import type { VaultMeta } from "@collector/shared";
import type { SqlExecutor } from "@collector/db";
import type { IndexedItem, VaultIndexAdapter } from "../adapters/types.js";

function serializeMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

export class SqlVaultIndexAdapter implements VaultIndexAdapter {
  constructor(private readonly db: SqlExecutor) {}

  async upsertVault(meta: VaultMeta, vaultPath: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO vaults (
        id, user_id, path, name, description, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        description = excluded.description,
        is_default = excluded.is_default,
        updated_at = excluded.updated_at`,
      [
        meta.id,
        meta.user_id,
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
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        updated_at = excluded.updated_at`,
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
        item.created_at,
        item.updated_at,
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
        "INSERT INTO item_collections (item_id, collection_id) VALUES (?, ?)",
        [item.id, collectionId],
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

  async deleteItem(itemId: string): Promise<void> {
    await this.db.execute("DELETE FROM source_refs WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM items_fts WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM items WHERE id = ?", [itemId]);
  }

  async listVaultItemIds(_vaultId: string): Promise<string[]> {
    throw new Error(
      "listVaultItemIds requires select(); use SqlVaultIndexStore instead",
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
}
