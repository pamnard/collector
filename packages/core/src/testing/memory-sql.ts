import type { SqlExecutor } from "@collector/db";
import type { SqlSelector } from "../index/sql-index.js";

export class MemorySqlAdapter implements SqlExecutor, SqlSelector {
  private readonly tables = new Map<string, Map<string, Record<string, unknown>>>();

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const normalized = query.trim().replace(/\s+/g, " ");

    if (
      normalized === "BEGIN" ||
      normalized === "COMMIT" ||
      normalized === "ROLLBACK"
    ) {
      return 0;
    }

    if (normalized.startsWith("UPDATE items SET file_mtime_ms = ?")) {
      return this.patchItemSyncMeta(bindValues);
    }

    if (normalized.startsWith("UPDATE vaults SET reconcile_fingerprint_json = ?")) {
      return this.setReconcileFingerprint(bindValues);
    }

    if (normalized.startsWith("UPDATE items SET has_content_file = ?")) {
      return this.patchItemHasContentFile(bindValues);
    }

    if (normalized.startsWith("INSERT INTO items_fts")) {
      return this.insertFts(bindValues);
    }

    if (normalized.startsWith("DELETE FROM items_fts")) {
      return this.deleteByField("items_fts", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM item_tags WHERE tag_id = ?")) {
      return this.deleteByField("item_tags", "tag_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM item_tags")) {
      return this.deleteByField("item_tags", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM item_collections")) {
      return this.deleteByField("item_collections", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM source_refs")) {
      return this.deleteByField("source_refs", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM media WHERE item_id")) {
      return this.deleteByField("media", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM media WHERE id")) {
      return this.deleteByField("media", "id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM items")) {
      return this.deleteByField("items", "id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM tags WHERE id = ?")) {
      return this.deleteByField("tags", "id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM vaults")) {
      return this.deleteByField("vaults", "id", bindValues[0]);
    }

    if (normalized.startsWith("INSERT INTO item_tags")) {
      let inserted = 0;
      for (let i = 0; i < bindValues.length; i += 2) {
        this.insertRow("item_tags", {
          item_id: bindValues[i],
          tag_id: bindValues[i + 1],
        });
        inserted += 1;
      }
      return inserted;
    }

    if (normalized.startsWith("INSERT INTO collections")) {
      const table = this.getTable("collections");
      let inserted = 0;
      for (let i = 0; i < bindValues.length; i += 5) {
        const id = String(bindValues[i]);
        if (table.has(id)) {
          continue;
        }
        table.set(id, {
          id,
          vault_id: bindValues[i + 1],
          parent_id: null,
          name: bindValues[i + 2],
          description: "",
          created_at: bindValues[i + 3],
          updated_at: bindValues[i + 4],
        });
        inserted += 1;
      }
      return inserted;
    }

    if (normalized.startsWith("INSERT INTO item_collections")) {
      let inserted = 0;
      for (let i = 0; i < bindValues.length; i += 2) {
        this.insertRow("item_collections", {
          item_id: bindValues[i],
          collection_id: bindValues[i + 1],
        });
        inserted += 1;
      }
      return inserted;
    }

    if (normalized.startsWith("INSERT INTO tags")) {
      return this.insertRow("tags", {
        id: bindValues[0],
        vault_id: bindValues[1],
        name: bindValues[2],
        color: bindValues[3],
        created_at: bindValues[4],
      });
    }

    if (normalized.startsWith("INSERT INTO source_refs")) {
      return this.insertRow("source_refs", {
        id: bindValues[0],
        item_id: bindValues[1],
        plugin_id: bindValues[2],
        external_id: bindValues[3],
        synced_at: bindValues[4],
        metadata_json: bindValues[5],
      });
    }

    if (normalized.startsWith("INSERT INTO vaults")) {
      return this.upsertVault(bindValues);
    }

    if (normalized.startsWith("INSERT INTO items")) {
      return this.upsertItem(bindValues);
    }

    if (normalized.startsWith("INSERT INTO media")) {
      return this.insertRow("media", {
        id: bindValues[0],
        item_id: bindValues[1],
        filename: bindValues[2],
        media_type: bindValues[3],
        created_at: bindValues[4],
      });
    }

    throw new Error(`Unsupported query in MemorySqlAdapter: ${normalized.slice(0, 80)}`);
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T[]> {
    const normalized = query.trim().replace(/\s+/g, " ");

    if (
      normalized.startsWith(
        "SELECT i.id FROM items i INNER JOIN item_tags it ON it.item_id = i.id",
      )
    ) {
      const vaultId = bindValues[0];
      const tagId = bindValues[1];
      const items = this.tables.get("items") ?? new Map();
      const itemTags = this.tables.get("item_tags") ?? new Map();
      const taggedItemIds = new Set(
        [...itemTags.values()]
          .filter((row) => row.tag_id === tagId)
          .map((row) => String(row.item_id)),
      );

      let rows = [...items.values()].filter(
        (row) => row.vault_id === vaultId && taggedItemIds.has(String(row.id)),
      );

      return rows.map((row) => ({ id: row.id })) as T[];
    }

    if (
      normalized.startsWith("SELECT i.id FROM items i WHERE i.vault_id = ?") &&
      normalized.includes("folder_path = ? OR i.folder_path LIKE ?")
    ) {
      const vaultId = bindValues[0];
      const folderPath = String(bindValues[1]);
      const folderPrefix = `${folderPath}/`;
      const items = this.tables.get("items") ?? new Map();

      let rows = [...items.values()].filter((row) => {
        if (row.vault_id !== vaultId) {
          return false;
        }
        const path = String(row.folder_path ?? "");
        return path === folderPath || path.startsWith(folderPrefix);
      });

      return rows.map((row) => ({ id: row.id })) as T[];
    }

    if (
      normalized.startsWith("SELECT id FROM items WHERE vault_id = ?") ||
      (normalized.startsWith("SELECT i.id FROM items i WHERE i.vault_id = ?") &&
        !normalized.includes("INNER JOIN item_tags") &&
        !normalized.includes("folder_path = ?"))
    ) {
      const vaultId = bindValues[0];
      const table = this.tables.get("items") ?? new Map();
      let rows = [...table.values()].filter((row) => row.vault_id === vaultId);

      return rows.map((row) => ({ id: row.id })) as T[];
    }

    if (
      normalized.startsWith(
        "SELECT id, file_mtime_ms, updated_at, content_revision FROM items WHERE vault_id = ?",
      )
    ) {
      const vaultId = bindValues[0];
      const table = this.tables.get("items") ?? new Map();
      const rows = [...table.values()].filter((row) => row.vault_id === vaultId);
      return rows.map((row) => ({
        id: row.id,
        file_mtime_ms: row.file_mtime_ms ?? null,
        updated_at: row.updated_at,
        content_revision: row.content_revision ?? 1,
      })) as T[];
    }

    if (
      normalized.startsWith(
        "SELECT reconcile_fingerprint_json FROM vaults WHERE id = ?",
      )
    ) {
      const vaultId = String(bindValues[0]);
      const table = this.tables.get("vaults") ?? new Map();
      const row = table.get(vaultId);
      if (!row) {
        return [] as T[];
      }
      return [{ reconcile_fingerprint_json: row.reconcile_fingerprint_json ?? null }] as T[];
    }

    if (
      normalized.startsWith(
        "SELECT folder_path, COUNT(*) AS item_count FROM items WHERE vault_id = ?",
      )
    ) {
      const vaultId = bindValues[0];
      const table = this.tables.get("items") ?? new Map();
      const counts = new Map<string, number>();
      for (const row of table.values()) {
        if (row.vault_id !== vaultId) {
          continue;
        }
        const folderPath = String(row.folder_path ?? "");
        counts.set(folderPath, (counts.get(folderPath) ?? 0) + 1);
      }
      return [...counts.entries()].map(([folder_path, item_count]) => ({
        folder_path,
        item_count,
      })) as T[];
    }

    if (
      normalized.startsWith("SELECT id, vault_id, title, description, url,") &&
      normalized.includes("FROM items WHERE vault_id = ? AND id IN")
    ) {
      const vaultId = bindValues[0];
      const ids = new Set(bindValues.slice(1).map(String));
      const table = this.tables.get("items") ?? new Map();
      return [...table.values()]
        .filter((row) => row.vault_id === vaultId && ids.has(String(row.id)))
        .map((row) => ({
          id: row.id,
          vault_id: row.vault_id,
          title: row.title,
          description: row.description,
          url: row.url,
          content_type: row.content_type,
          source_type: row.source_type,
          source_id: row.source_id,
          metadata_json: row.metadata_json,
          thumbnail_path: row.thumbnail_path,
          folder_path: row.folder_path,
          content_revision: row.content_revision,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })) as T[];
    }

    if (normalized.startsWith("SELECT item_id, tag_id FROM item_tags WHERE item_id IN")) {
      const ids = new Set(bindValues.map(String));
      const table = this.tables.get("item_tags") ?? new Map();
      return [...table.values()]
        .filter((row) => ids.has(String(row.item_id)))
        .map((row) => ({ item_id: row.item_id, tag_id: row.tag_id })) as T[];
    }

    if (
      normalized.startsWith("SELECT item_id, collection_id FROM item_collections WHERE item_id IN",
      )
    ) {
      const ids = new Set(bindValues.map(String));
      const table = this.tables.get("item_collections") ?? new Map();
      return [...table.values()]
        .filter((row) => ids.has(String(row.item_id)))
        .map((row) => ({
          item_id: row.item_id,
          collection_id: row.collection_id,
        })) as T[];
    }

    throw new Error(`Unsupported select in MemorySqlAdapter: ${normalized.slice(0, 80)}`);
  }

  private insertFts(bindValues: unknown[]): number {
    const table = this.getTable("items_fts");
    const itemId = String(bindValues[0]);
    table.set(itemId, {
      item_id: itemId,
      title: bindValues[1],
      description: bindValues[2],
      content: bindValues[3],
    });
    return 1;
  }

  private upsertVault(bindValues: unknown[]): number {
    const table = this.getTable("vaults");
    const id = String(bindValues[0]);
    const existing = table.get(id);
    table.set(id, {
      id,
      path: bindValues[1],
      name: bindValues[2],
      description: bindValues[3],
      is_default: bindValues[4],
      created_at: bindValues[5],
      updated_at: bindValues[6],
      reconcile_fingerprint_json: existing?.reconcile_fingerprint_json ?? null,
    });
    return 1;
  }

  private setReconcileFingerprint(bindValues: unknown[]): number {
    const table = this.getTable("vaults");
    const fingerprintJson = bindValues[0];
    const vaultId = String(bindValues[1]);
    const row = table.get(vaultId);
    if (!row) {
      return 0;
    }
    table.set(vaultId, {
      ...row,
      reconcile_fingerprint_json: fingerprintJson,
    });
    return 1;
  }

  private patchItemSyncMeta(bindValues: unknown[]): number {
    const table = this.getTable("items");
    const fileMtimeMs = bindValues[0];
    const updatedAt = bindValues[1];
    const contentRevision = bindValues[2];
    const itemId = String(bindValues[3]);
    const row = table.get(itemId);
    if (!row) {
      return 0;
    }
    table.set(itemId, {
      ...row,
      file_mtime_ms: fileMtimeMs,
      updated_at: updatedAt,
      content_revision: contentRevision,
    });
    return 1;
  }

  private patchItemHasContentFile(bindValues: unknown[]): number {
    const table = this.getTable("items");
    const hasContentFile = bindValues[0];
    const itemId = String(bindValues[1]);
    const row = table.get(itemId);
    if (!row) {
      return 0;
    }
    table.set(itemId, {
      ...row,
      has_content_file: hasContentFile,
    });
    return 1;
  }

  private upsertItem(bindValues: unknown[]): number {
    const table = this.getTable("items");
    const id = String(bindValues[0]);
    table.set(id, {
      id,
      vault_id: bindValues[1],
      title: bindValues[2],
      description: bindValues[3],
      url: bindValues[4],
      content_type: bindValues[5],
      source_type: bindValues[6],
      source_id: bindValues[7],
      metadata_json: bindValues[8],
      thumbnail_path: bindValues[9],
      has_content_file: bindValues[10],
      folder_path: bindValues[11],
      created_at: bindValues[12],
      updated_at: bindValues[13],
      file_mtime_ms: bindValues[14],
      content_revision: bindValues[15],
    });
    return 1;
  }

  private insertRow(tableName: string, row: Record<string, unknown>): number {
    const table = this.getTable(tableName);
    const key = Object.values(row).join(":");
    table.set(key, row);
    return 1;
  }

  private deleteByField(tableName: string, field: string, value: unknown): number {
    const table = this.getTable(tableName);
    let removed = 0;
    for (const [key, row] of table.entries()) {
      if (row[field] === value) {
        table.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private getTable(name: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name)!;
  }
}
