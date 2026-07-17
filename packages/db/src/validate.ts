import { ITEMS_COLUMNS, INDEX_TABLES } from "./schema.js";
import type { SqlMigrator } from "./migrate.js";

export interface IndexValidationResult {
  ok: boolean;
  errors: string[];
}

async function tableExists(db: SqlMigrator, table: string): Promise<boolean> {
  const rows = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  return rows.length > 0;
}

async function tableColumns(db: SqlMigrator, table: string): Promise<Set<string>> {
  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

export async function validateIndexSchema(db: SqlMigrator): Promise<IndexValidationResult> {
  const errors: string[] = [];

  for (const table of INDEX_TABLES) {
    if (!(await tableExists(db, table))) {
      errors.push(`missing table: ${table}`);
    }
  }

  if (errors.length === 0) {
    const columns = await tableColumns(db, "items");
    for (const column of ITEMS_COLUMNS) {
      if (!columns.has(column)) {
        errors.push(`items missing column: ${column}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Queries the app runs during normal use — fail fast at startup if schema is wrong. */
export async function runIndexStartupChecks(db: SqlMigrator): Promise<IndexValidationResult> {
  const errors: string[] = [];

  const probes: Array<{ label: string; run: () => Promise<unknown> }> = [
    {
      label: "items nav filter",
      run: () =>
        db.select(
          "SELECT id FROM items WHERE vault_id = ? ORDER BY created_at DESC LIMIT 1",
          ["00000000-0000-0000-0000-000000000000"],
        ),
    },
    {
      label: "items folder filter",
      run: () =>
        db.select(
          `SELECT id FROM items
           WHERE vault_id = ?
             AND (folder_path = ? OR folder_path LIKE ?)
           LIMIT 1`,
          ["00000000-0000-0000-0000-000000000000", "inbox", "inbox/%"],
        ),
    },
    {
      label: "item tags join",
      run: () =>
        db.select(
          `SELECT i.id
           FROM items i
           INNER JOIN item_tags it ON it.item_id = i.id
           WHERE i.vault_id = ? AND it.tag_id = ?
           LIMIT 1`,
          ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000001"],
        ),
    },
    {
      label: "tags list",
      run: () =>
        db.select(
          `SELECT t.id, t.name, t.color, t.created_at, COUNT(it.item_id) AS item_count
           FROM tags t
           LEFT JOIN item_tags it ON it.tag_id = t.id
           LEFT JOIN items i ON i.id = it.item_id AND i.vault_id = ?
           WHERE t.vault_id = ?
           GROUP BY t.id
           LIMIT 1`,
          ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"],
        ),
    },
    {
      label: "fts search",
      run: () =>
        db.select(
          `SELECT i.id
           FROM items_fts
           INNER JOIN items i ON i.id = items_fts.item_id
           WHERE items_fts MATCH ?
             AND i.vault_id = ?
           LIMIT 1`,
          ["welcome", "00000000-0000-0000-0000-000000000000"],
        ),
    },
  ];

  for (const probe of probes) {
    try {
      await probe.run();
    } catch (error) {
      errors.push(
        `${probe.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function ensureHealthyIndex(db: SqlMigrator): Promise<IndexValidationResult> {
  const schema = await validateIndexSchema(db);
  if (!schema.ok) {
    return schema;
  }
  return runIndexStartupChecks(db);
}
