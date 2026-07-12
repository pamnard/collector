/**
 * Creates a legacy broken index DB (migration v1 recorded, items missing columns).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { BetterSqliteMigrator } from "../packages/db/dist/testing/better-sqlite.js";

export async function writeLegacyBrokenIndexDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });

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
  db.close();
}

export function legacyConfigIndexPath(home) {
  return join(home, ".config/com.collector.app/collector.db");
}

export function canonicalIndexPath(home) {
  return legacyConfigIndexPath(home);
}

export function wrongDataDirIndexPath(home) {
  return join(home, ".local/share/com.collector.app/collector/collector.db");
}
