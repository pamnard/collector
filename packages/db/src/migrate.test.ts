import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "./migrate.js";
import { BetterSqliteMigrator } from "./testing/better-sqlite.js";

describe("runMigrations", () => {
  let tempDir = "";
  let dbPath = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
      dbPath = "";
    }
  });

  it("applies all migrations on a fresh database", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);

    const applied = await runMigrations(db);
    expect(applied).toEqual([1, 2]);

    const versions = await db.select<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(CURRENT_SCHEMA_VERSION).toBe(2);

    const columns = await db.select<{ name: string }>("PRAGMA table_info(items)");
    expect(columns.some((column) => column.name === "sort_order")).toBe(true);

    db.close();
  });

  it("applies only pending migrations when schema_migrations already has v1", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector-v1.db");
    const db = BetterSqliteMigrator.open(dbPath);

    const firstPass = await runMigrations(db);
    expect(firstPass).toEqual([1, 2]);

    const secondPass = await runMigrations(db);
    expect(secondPass).toEqual([]);

    db.close();
  });

  it("upgrades a legacy v1 database without sort_order column", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector-legacy.db");
    const db = BetterSqliteMigrator.open(dbPath);

    await db.execute(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
    await db.execute(
      "INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))",
    );
    await db.execute(`CREATE TABLE items (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      url TEXT,
      content_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      thumbnail_path TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      has_content_file INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    const applied = await runMigrations(db);
    expect(applied).toEqual([2]);

    const columns = await db.select<{ name: string }>("PRAGMA table_info(items)");
    expect(columns.some((column) => column.name === "sort_order")).toBe(true);

    db.close();
  });
});
