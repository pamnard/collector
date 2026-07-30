import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("fails schema validation when a required table is missing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector-missing-table.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await runMigrations(db);

    await db.execute("DROP TABLE item_tags");

    const schema = await validateIndexSchema(db);
    expect(schema.ok).toBe(false);
    expect(schema.errors.some((error) => error.includes("missing table: item_tags"))).toBe(
      true,
    );

    const health = await ensureHealthyIndex(db);
    expect(health.ok).toBe(false);
    expect(health.errors).toEqual(schema.errors);

    db.close();
  });

  it("ensureHealthyIndex short-circuits on schema failure without startup probes", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector-short-circuit.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await runMigrations(db);
    await db.execute("DROP TABLE tags");

    const selectSpy = vi.spyOn(db, "select");
    const health = await ensureHealthyIndex(db);
    expect(health.ok).toBe(false);
    expect(health.errors.some((error) => error.includes("missing table: tags"))).toBe(
      true,
    );
    const probeLabels = selectSpy.mock.calls.filter((call) => {
      const sql = String(call[0]);
      return (
        sql.includes("items_fts MATCH") ||
        sql.includes("INNER JOIN item_tags") ||
        sql.includes("FROM tags t")
      );
    });
    expect(probeLabels).toHaveLength(0);
    selectSpy.mockRestore();

    db.close();
  });

  it("runIndexStartupChecks reports fts search label when items_fts is broken", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-"));
    dbPath = join(tempDir, "collector-fts-broken.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await runMigrations(db);

    await db.execute("DROP TABLE items_fts");

    const schema = await validateIndexSchema(db);
    expect(schema.ok).toBe(false);
    expect(schema.errors.some((error) => error.includes("missing table: items_fts"))).toBe(
      true,
    );

    // Recreate tables list gap only for startup probes: open a fresh migrated DB
    // and replace FTS with a non-MATCH table so schema tableExists still passes
    // for other tables — drop FTS content via rename after schema check path.
    db.close();

    const db2Path = join(tempDir, "collector-fts-probe.db");
    const db2 = BetterSqliteMigrator.open(db2Path);
    await runMigrations(db2);
    await db2.execute("DROP TABLE items_fts");
    await db2.execute(`CREATE TABLE items_fts (
      item_id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      content TEXT,
      tags TEXT
    )`);

    const schemaOk = await validateIndexSchema(db2);
    expect(schemaOk.ok).toBe(true);

    const startup = await runIndexStartupChecks(db2);
    expect(startup.ok).toBe(false);
    expect(
      startup.errors.some((error) => error.startsWith("fts search:")),
    ).toBe(true);

    db2.close();
  });
});
