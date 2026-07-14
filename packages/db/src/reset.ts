import type { SqlMigrator } from "./migrate.js";

/** Drop order: children before parents (reverse dependency order). */
const DROP_ORDER = [
  "items_fts",
  "source_refs",
  "media",
  "item_collections",
  "item_tags",
  "items",
  "tags",
  "collections",
  "vaults",
  "schema_migrations",
] as const;

/** Drop all index tables in-place so migrations can recreate a fresh schema on the same pool. */
export async function resetIndexSchema(db: SqlMigrator): Promise<void> {
  await db.execute("PRAGMA foreign_keys = OFF");

  for (const table of DROP_ORDER) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }

  await db.execute("PRAGMA foreign_keys = ON");
}
