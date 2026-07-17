import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "./migrate.js";
import { ITEMS_COLUMNS } from "./schema.js";
import {
  ensureHealthyIndex,
  runIndexStartupChecks,
  validateIndexSchema,
} from "./validate.js";
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

  it("applies schema migrations on a fresh database", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);

    const applied = await runMigrations(db);
    expect(applied).toEqual([1]);
    expect(CURRENT_SCHEMA_VERSION).toBe(1);

    const columns = await db.select<{ name: string }>("PRAGMA table_info(items)");
    for (const column of ITEMS_COLUMNS) {
      expect(columns.some((entry) => entry.name === column)).toBe(true);
    }

    db.close();
  });

  it("is a no-op on second run", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);

    await runMigrations(db);
    expect(await runMigrations(db)).toEqual([]);

    db.close();
  });
});

describe("index startup validation", () => {
  let tempDir = "";
  let dbPath = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
      dbPath = "";
    }
  });

  it("passes schema and startup probes on a fresh database", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await runMigrations(db);

    const health = await ensureHealthyIndex(db);
    expect(health.ok).toBe(true);
    expect(health.errors).toEqual([]);

    db.close();
  });

  it("fails schema validation when items table is missing folder_path", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector-legacy.db");
    const db = BetterSqliteMigrator.open(dbPath);

    await runMigrations(db);

    await db.execute(`CREATE TABLE items_legacy AS SELECT id, vault_id, title FROM items`);
    await db.execute("DROP TABLE items");
    await db.execute(`CREATE TABLE items (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL,
      title TEXT NOT NULL
    )`);
    await db.execute("INSERT INTO items SELECT id, vault_id, title FROM items_legacy");
    await db.execute("DROP TABLE items_legacy");

    const schema = await validateIndexSchema(db);
    expect(schema.ok).toBe(false);
    expect(schema.errors.some((error) => error.includes("folder_path"))).toBe(true);

    const startup = await runIndexStartupChecks(db);
    expect(startup.ok).toBe(false);
    expect(startup.errors.length).toBeGreaterThan(0);

    db.close();
  });
});
