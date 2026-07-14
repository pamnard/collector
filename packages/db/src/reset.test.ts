import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { resetIndexSchema } from "./reset.js";
import { ensureHealthyIndex } from "./validate.js";
import { BetterSqliteMigrator } from "./testing/better-sqlite.js";

async function writeLegacyBrokenIndexDb(db: BetterSqliteMigrator): Promise<void> {
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
    title TEXT NOT NULL
  )`);
  await db.execute(`CREATE VIRTUAL TABLE items_fts USING fts5(
    item_id UNINDEXED,
    title,
    description,
    content,
    tokenize = 'unicode61'
  )`);
  await db.execute(`CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE item_tags (
    item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_id)
  )`);
}

describe("resetIndexSchema", () => {
  let tempDir = "";
  let dbPath = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
      dbPath = "";
    }
  });

  it("repairs a legacy broken database in-place", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-reset-"));
    dbPath = join(tempDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await writeLegacyBrokenIndexDb(db);

    const before = await ensureHealthyIndex(db);
    expect(before.ok).toBe(false);

    await resetIndexSchema(db);
    await runMigrations(db);

    const after = await ensureHealthyIndex(db);
    expect(after.ok).toBe(true);
    expect(after.errors).toEqual([]);

    db.close();
  });

  it("allows migrations to re-apply on a fresh database after reset", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-db-reset-"));
    dbPath = join(tempDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);

    expect(await runMigrations(db)).toEqual([1, 2]);
    await resetIndexSchema(db);
    expect(await runMigrations(db)).toEqual([1, 2]);

    const health = await ensureHealthyIndex(db);
    expect(health.ok).toBe(true);
    expect(health.errors).toEqual([]);

    db.close();
  });
});
