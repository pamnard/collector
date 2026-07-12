import type { SqlExecutor } from "@collector/db";
import type { SqlSelector } from "../index/sql-index.js";

export class MemorySqlAdapter implements SqlExecutor, SqlSelector {
  private readonly tables = new Map<string, Map<string, Record<string, unknown>>>();

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const normalized = query.trim().replace(/\s+/g, " ");

    if (normalized.startsWith("INSERT INTO items_fts")) {
      return this.insertFts(bindValues);
    }

    if (normalized.startsWith("DELETE FROM items_fts")) {
      return this.deleteByField("items_fts", "item_id", bindValues[0]);
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

    if (normalized.startsWith("DELETE FROM vaults")) {
      return this.deleteByField("vaults", "id", bindValues[0]);
    }

    if (normalized.startsWith("INSERT INTO item_tags")) {
      return this.insertRow("item_tags", {
        item_id: bindValues[0],
        tag_id: bindValues[1],
      });
    }

    if (normalized.startsWith("INSERT INTO item_collections")) {
      return this.insertRow("item_collections", {
        item_id: bindValues[0],
        collection_id: bindValues[1],
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
    if (!normalized.startsWith("SELECT id FROM items WHERE vault_id = ?")) {
      throw new Error(`Unsupported select in MemorySqlAdapter: ${normalized}`);
    }

    const vaultId = bindValues[0];
    const table = this.tables.get("items") ?? new Map();
    const rows = [...table.values()].filter((row) => row.vault_id === vaultId);
    return rows.map((row) => ({ id: row.id })) as T[];
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
    table.set(id, {
      id,
      path: bindValues[1],
      name: bindValues[2],
      description: bindValues[3],
      is_default: bindValues[4],
      created_at: bindValues[5],
      updated_at: bindValues[6],
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
      is_archived: bindValues[10],
      is_favorite: bindValues[11],
      has_content_file: bindValues[12],
      created_at: bindValues[13],
      updated_at: bindValues[14],
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
