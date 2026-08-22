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

    if (normalized.startsWith("UPDATE items SET file_mtime_ms = CASE id")) {
      return this.patchItemSyncMetaBatch(bindValues);
    }

    if (normalized.startsWith("UPDATE vaults SET reconcile_fingerprint_json = ?")) {
      return this.setReconcileFingerprint(bindValues);
    }

    if (normalized.startsWith("UPDATE items SET has_content_file = ?")) {
      return this.patchItemHasContentFile(bindValues);
    }

    if (normalized.startsWith("UPDATE items SET has_content_file = CASE id")) {
      return this.patchItemHasContentFileBatch(bindValues);
    }

    if (normalized.startsWith("INSERT INTO items_fts")) {
      return this.insertFts(bindValues);
    }

    if (normalized.startsWith("DELETE FROM items_fts")) {
      if (normalized.includes(" IN (")) {
        return this.deleteByFieldValues("items_fts", "item_id", bindValues);
      }
      return this.deleteByField("items_fts", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM item_embeddings")) {
      if (normalized.includes(" IN (")) {
        return this.deleteByFieldValues(
          "item_embeddings",
          "item_id",
          bindValues,
        );
      }
      return this.deleteByField("item_embeddings", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM item_edges")) {
      if (
        normalized.includes("vault_id = ?") &&
        normalized.includes("source = 'user'")
      ) {
        const table = this.getTable("item_edges");
        let deleted = 0;
        for (const [key, row] of [...table.entries()]) {
          if (
            row.vault_id === bindValues[0] &&
            row.source === "user" &&
            row.from_id === bindValues[1] &&
            row.to_id === bindValues[2]
          ) {
            table.delete(key);
            deleted += 1;
          }
        }
        return deleted;
      }
      if (
        normalized.includes("vault_id = ?") &&
        normalized.includes("source = 'text'")
      ) {
        const table = this.getTable("item_edges");
        let deleted = 0;
        for (const [key, row] of [...table.entries()]) {
          if (row.vault_id === bindValues[0] && row.source === "text") {
            table.delete(key);
            deleted += 1;
          }
        }
        return deleted;
      }
      if (
        normalized.includes("from_id = ?") &&
        normalized.includes("source = 'text'")
      ) {
        const table = this.getTable("item_edges");
        let deleted = 0;
        for (const [key, row] of [...table.entries()]) {
          if (row.from_id === bindValues[0] && row.source === "text") {
            table.delete(key);
            deleted += 1;
          }
        }
        return deleted;
      }
      if (normalized.includes(" id IN (")) {
        return this.deleteByFieldValues("item_edges", "id", bindValues);
      }
    }

    if (normalized.startsWith("DELETE FROM item_tags WHERE tag_id = ?")) {
      return this.deleteByField("item_tags", "tag_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM item_tags")) {
      if (normalized.includes(" IN (")) {
        return this.deleteByFieldValues("item_tags", "item_id", bindValues);
      }
      return this.deleteByField("item_tags", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM item_collections")) {
      if (normalized.includes(" IN (")) {
        return this.deleteByFieldValues(
          "item_collections",
          "item_id",
          bindValues,
        );
      }
      return this.deleteByField("item_collections", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM source_refs")) {
      if (normalized.includes("(plugin_id, external_id) IN")) {
        return this.deleteSourceRefsByExternalIds(bindValues);
      }
      if (normalized.includes(" IN (")) {
        return this.deleteByFieldValues("source_refs", "item_id", bindValues);
      }
      return this.deleteByField("source_refs", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM media WHERE item_id")) {
      if (normalized.includes(" IN (")) {
        return this.deleteByFieldValues("media", "item_id", bindValues);
      }
      return this.deleteByField("media", "item_id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM media WHERE id")) {
      return this.deleteByField("media", "id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM items")) {
      if (normalized.includes(" IN (")) {
        return this.deleteByFieldValues("items", "id", bindValues);
      }
      return this.deleteByField("items", "id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM tags WHERE id = ?")) {
      return this.deleteByField("tags", "id", bindValues[0]);
    }

    if (normalized.startsWith("DELETE FROM vaults")) {
      return this.deleteByField("vaults", "id", bindValues[0]);
    }

    if (
      normalized.startsWith(
        "INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, ?",
      )
    ) {
      const newTagId = bindValues[0];
      const oldTagId = String(bindValues[1]);
      const table = this.getTable("item_tags");
      let inserted = 0;
      for (const row of [...table.values()]) {
        if (String(row.tag_id) !== oldTagId) {
          continue;
        }
        inserted += this.insertRow("item_tags", {
          item_id: row.item_id,
          tag_id: newTagId,
        });
      }
      return inserted;
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
      let inserted = 0;
      for (let i = 0; i < bindValues.length; i += 6) {
        inserted += this.insertRow("source_refs", {
          id: bindValues[i],
          item_id: bindValues[i + 1],
          plugin_id: bindValues[i + 2],
          external_id: bindValues[i + 3],
          synced_at: bindValues[i + 4],
          metadata_json: bindValues[i + 5],
        });
      }
      return inserted;
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

    if (
      normalized.startsWith("INSERT INTO item_edges") ||
      normalized.startsWith("INSERT OR IGNORE INTO item_edges")
    ) {
      const ignore = normalized.startsWith("INSERT OR IGNORE");
      let inserted = 0;
      for (let i = 0; i < bindValues.length; i += 11) {
        const row = {
          id: bindValues[i],
          vault_id: bindValues[i + 1],
          from_id: bindValues[i + 2],
          to_id: bindValues[i + 3],
          raw_target: bindValues[i + 4],
          source: bindValues[i + 5],
          kind: bindValues[i + 6],
          position: bindValues[i + 7],
          resolve_status: bindValues[i + 8],
          created_at: bindValues[i + 9],
          updated_at: bindValues[i + 10],
        };
        if (ignore && row.source === "user") {
          const table = this.getTable("item_edges");
          const exists = [...table.values()].some(
            (existing) =>
              existing.vault_id === row.vault_id &&
              existing.source === "user" &&
              existing.from_id === row.from_id &&
              existing.to_id === row.to_id,
          );
          if (exists) {
            continue;
          }
        }
        inserted += this.insertRow("item_edges", row);
      }
      return inserted;
    }

    throw new Error(`Unsupported query in MemorySqlAdapter: ${normalized.slice(0, 80)}`);
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T[]> {
    const normalized = query.trim().replace(/\s+/g, " ");

    if (normalized === "SELECT vault_id FROM items WHERE id = ?") {
      const itemId = String(bindValues[0]);
      const table = this.tables.get("items") ?? new Map();
      const row = table.get(itemId);
      if (!row) {
        return [];
      }
      return [{ vault_id: row.vault_id }] as T[];
    }

    if (normalized.startsWith("SELECT vault_id FROM items WHERE id IN (")) {
      const ids = new Set(bindValues.map(String));
      const table = this.tables.get("items") ?? new Map();
      return [...table.values()]
        .filter((row) => ids.has(String(row.id)))
        .map((row) => ({ vault_id: row.vault_id })) as T[];
    }

    if (normalized === "SELECT id, title FROM items WHERE vault_id = ?") {
      const vaultId = bindValues[0];
      const table = this.tables.get("items") ?? new Map();
      return [...table.values()]
        .filter((row) => row.vault_id === vaultId)
        .map((row) => ({ id: row.id, title: row.title })) as T[];
    }

    if (normalized.startsWith("SELECT id FROM items WHERE id = ? AND vault_id = ?")) {
      const itemId = String(bindValues[0]);
      const vaultId = bindValues[1];
      const table = this.tables.get("items") ?? new Map();
      const row = table.get(itemId);
      if (!row || row.vault_id !== vaultId) {
        return [];
      }
      return [{ id: row.id }] as T[];
    }

    if (
      normalized.startsWith(
        "SELECT i.id AS id, i.title AS title FROM item_edges e INNER JOIN items i ON i.id = e.from_id",
      )
    ) {
      const targetId = bindValues[0];
      const edges = this.tables.get("item_edges") ?? new Map();
      const items = this.tables.get("items") ?? new Map();
      const out: Array<{ id: string; title: string }> = [];
      for (const edge of edges.values()) {
        if (
          edge.to_id !== targetId ||
          edge.source !== "text" ||
          edge.resolve_status !== "resolved"
        ) {
          continue;
        }
        const item = items.get(String(edge.from_id));
        if (!item) {
          continue;
        }
        out.push({ id: String(item.id), title: String(item.title) });
      }
      out.sort((a, b) =>
        a.title === b.title
          ? a.id.localeCompare(b.id)
          : a.title.localeCompare(b.title),
      );
      return out as T[];
    }

    if (
      normalized.startsWith(
        "SELECT i.id AS id, i.title AS title FROM item_edges e INNER JOIN items i ON i.id = CASE",
      )
    ) {
      const itemId = bindValues[0];
      const vaultId = bindValues[1];
      const edges = this.tables.get("item_edges") ?? new Map();
      const items = this.tables.get("items") ?? new Map();
      const out: Array<{ id: string; title: string }> = [];
      for (const edge of edges.values()) {
        if (edge.vault_id !== vaultId || edge.source !== "user") {
          continue;
        }
        if (edge.from_id !== itemId && edge.to_id !== itemId) {
          continue;
        }
        const neighborId =
          edge.from_id === itemId ? String(edge.to_id) : String(edge.from_id);
        const item = items.get(neighborId);
        if (!item) {
          continue;
        }
        out.push({ id: neighborId, title: String(item.title) });
      }
      out.sort((a, b) =>
        a.title === b.title
          ? a.id.localeCompare(b.id)
          : a.title.localeCompare(b.title),
      );
      return out as T[];
    }

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
      normalized.startsWith("SELECT i.id FROM items i WHERE i.vault_id = ?") &&
      normalized.includes("i.folder_path = ?") &&
      !normalized.includes("LIKE ?")
    ) {
      const vaultId = bindValues[0];
      const folderPath = String(bindValues[1]);
      const items = this.tables.get("items") ?? new Map();

      let rows = [...items.values()].filter((row) => {
        if (row.vault_id !== vaultId) {
          return false;
        }
        return String(row.folder_path ?? "") === folderPath;
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
        "SELECT id, file_mtime_ms, updated_at, content_revision, created_at FROM items WHERE vault_id = ?",
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
        created_at: row.created_at,
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
          properties_json: row.properties_json ?? "{}",
          thumbnail_path: row.thumbnail_path,
          folder_path: row.folder_path,
          content_revision: row.content_revision,
          word_count: row.word_count,
          character_count: row.character_count,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })) as T[];
    }

    if (
      normalized.startsWith(
        "SELECT id FROM tags WHERE vault_id = ? AND name = ? AND id != ?",
      )
    ) {
      const vaultId = bindValues[0];
      const name = bindValues[1];
      const excludeId = String(bindValues[2]);
      const table = this.tables.get("tags") ?? new Map();
      return [...table.values()]
        .filter(
          (row) =>
            row.vault_id === vaultId &&
            row.name === name &&
            String(row.id) !== excludeId,
        )
        .map((row) => ({ id: row.id })) as T[];
    }

    if (normalized.startsWith("SELECT item_id, tag_id FROM item_tags WHERE item_id IN")) {
      const ids = new Set(bindValues.map(String));
      const table = this.tables.get("item_tags") ?? new Map();
      return [...table.values()]
        .filter((row) => ids.has(String(row.item_id)))
        .map((row) => ({ item_id: row.item_id, tag_id: row.tag_id })) as T[];
    }

    if (normalized.startsWith("SELECT item_id, collection_id FROM item_collections WHERE item_id IN",
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

    if (
      normalized.startsWith(
        "SELECT i.id AS id, i.title AS title, items_fts.content AS content",
      )
    ) {
      const vaultId = bindValues[0];
      const items = this.tables.get("items") ?? new Map();
      const fts = this.tables.get("items_fts") ?? new Map();
      const out: Array<{ id: string; title: string; content: string }> = [];
      for (const row of items.values()) {
        if (row.vault_id !== vaultId || Number(row.has_content_file) !== 1) {
          continue;
        }
        const ftsRow = fts.get(String(row.id));
        if (!ftsRow) {
          continue;
        }
        out.push({
          id: String(row.id),
          title: String(row.title),
          content: String(ftsRow.content ?? ""),
        });
      }
      return out as T[];
    }

    if (
      normalized.startsWith(
        "SELECT MAX(content_revision) AS generation FROM items WHERE vault_id = ?",
      )
    ) {
      const vaultId = bindValues[0];
      const items = this.tables.get("items") ?? new Map();
      let max = 0;
      let any = false;
      for (const row of items.values()) {
        if (row.vault_id !== vaultId) {
          continue;
        }
        any = true;
        const rev = Number(row.content_revision ?? 0);
        if (rev > max) {
          max = rev;
        }
      }
      return [{ generation: any ? max : null }] as T[];
    }

    if (
      normalized.startsWith(
        "SELECT id, file_mtime_ms FROM items WHERE vault_id = ? AND id IN",
      )
    ) {
      const vaultId = bindValues[0];
      const ids = new Set(bindValues.slice(1).map(String));
      const table = this.tables.get("items") ?? new Map();
      return [...table.values()]
        .filter((row) => row.vault_id === vaultId && ids.has(String(row.id)))
        .map((row) => ({
          id: row.id,
          file_mtime_ms: row.file_mtime_ms ?? null,
        })) as T[];
    }

    throw new Error(`Unsupported select in MemorySqlAdapter: ${normalized.slice(0, 80)}`);
  }

  private insertFts(bindValues: unknown[]): number {
    const table = this.getTable("items_fts");
    let inserted = 0;
    for (let i = 0; i < bindValues.length; i += 4) {
      const itemId = String(bindValues[i]);
      table.set(itemId, {
        item_id: itemId,
        title: bindValues[i + 1],
        description: bindValues[i + 2],
        content: bindValues[i + 3],
      });
      inserted += 1;
    }
    return inserted;
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
    const createdAt = bindValues[3];
    const itemId = String(bindValues[4]);
    const row = table.get(itemId);
    if (!row) {
      return 0;
    }
    table.set(itemId, {
      ...row,
      file_mtime_ms: fileMtimeMs,
      updated_at: updatedAt,
      content_revision: contentRevision,
      created_at: createdAt,
    });
    return 1;
  }

  private patchItemSyncMetaBatch(bindValues: unknown[]): number {
    const patchCount = bindValues.length / 9;
    const table = this.getTable("items");
    let updated = 0;
    for (let i = 0; i < patchCount; i += 1) {
      const itemId = String(bindValues[patchCount * 8 + i]);
      const row = table.get(itemId);
      if (!row) {
        continue;
      }
      table.set(itemId, {
        ...row,
        file_mtime_ms: bindValues[i * 2 + 1],
        updated_at: bindValues[patchCount * 2 + i * 2 + 1],
        content_revision: bindValues[patchCount * 4 + i * 2 + 1],
        created_at: bindValues[patchCount * 6 + i * 2 + 1],
      });
      updated += 1;
    }
    return updated;
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

  private patchItemHasContentFileBatch(bindValues: unknown[]): number {
    const inputCount = bindValues.length / 3;
    const table = this.getTable("items");
    let updated = 0;
    for (let i = 0; i < inputCount; i += 1) {
      const itemId = String(bindValues[inputCount * 2 + i]);
      const row = table.get(itemId);
      if (!row) {
        continue;
      }
      table.set(itemId, {
        ...row,
        has_content_file: bindValues[i * 2 + 1],
      });
      updated += 1;
    }
    return updated;
  }

  private upsertItem(bindValues: unknown[]): number {
    const table = this.getTable("items");
    let upserted = 0;
    for (let i = 0; i < bindValues.length; i += 19) {
      const id = String(bindValues[i]);
      const existing = table.get(id);
      table.set(id, {
        id,
        vault_id: bindValues[i + 1],
        title: bindValues[i + 2],
        description: bindValues[i + 3],
        url: bindValues[i + 4],
        content_type: bindValues[i + 5],
        source_type: bindValues[i + 6],
        source_id: bindValues[i + 7],
        metadata_json: bindValues[i + 8],
        properties_json: bindValues[i + 9],
        thumbnail_path: bindValues[i + 10],
        has_content_file: existing?.has_content_file ?? bindValues[i + 11],
        folder_path: bindValues[i + 12],
        created_at: bindValues[i + 13],
        updated_at: bindValues[i + 14],
        file_mtime_ms: bindValues[i + 15],
        content_revision: bindValues[i + 16],
        word_count: bindValues[i + 17],
        character_count: bindValues[i + 18],
      });
      upserted += 1;
    }
    return upserted;
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

  private deleteByFieldValues(
    tableName: string,
    field: string,
    values: unknown[],
  ): number {
    const expected = new Set(values);
    const table = this.getTable(tableName);
    let removed = 0;
    for (const [key, row] of table.entries()) {
      if (expected.has(row[field])) {
        table.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private deleteSourceRefsByExternalIds(bindValues: unknown[]): number {
    const externalRefs = new Set<string>();
    for (let i = 0; i < bindValues.length; i += 2) {
      externalRefs.add(`${bindValues[i]}\u0000${bindValues[i + 1]}`);
    }
    const table = this.getTable("source_refs");
    let removed = 0;
    for (const [key, row] of table.entries()) {
      if (externalRefs.has(`${row.plugin_id}\u0000${row.external_id}`)) {
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
