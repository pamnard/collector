/**
 * Simulates app startup against a broken index DB and verifies auto-rebuild path.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../packages/db/dist/migrate.js";
import { resetIndexSchema } from "../packages/db/dist/reset.js";
import {
  ensureHealthyIndex,
  validateIndexSchema,
} from "../packages/db/dist/validate.js";
import { BetterSqliteMigrator } from "../packages/db/dist/testing/better-sqlite.js";

function openDb(path) {
  return BetterSqliteMigrator.open(path);
}

async function simulateRebuildFromBrokenDb(dbPath) {
  const broken = openDb(dbPath);

  await broken.execute(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  await broken.execute(
    "INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))",
  );
  await broken.execute(`CREATE TABLE items (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    title TEXT NOT NULL
  )`);
  await broken.execute(`CREATE VIRTUAL TABLE items_fts USING fts5(
    item_id UNINDEXED,
    title,
    description,
    content,
    tokenize = 'unicode61'
  )`);
  await broken.execute(`CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL
  )`);
  await broken.execute(`CREATE TABLE item_tags (
    item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_id)
  )`);

  const before = await ensureHealthyIndex(broken);
  if (before.ok) {
    broken.close();
    throw new Error("expected broken DB to fail startup checks");
  }

  await resetIndexSchema(broken);
  await runMigrations(broken);
  const after = await ensureHealthyIndex(broken);
  if (!after.ok) {
    broken.close();
    throw new Error(`rebuilt DB still unhealthy: ${after.errors.join("; ")}`);
  }
  broken.close();
}

const dir = mkdtempSync(join(tmpdir(), "collector-startup-smoke-"));
const dbPath = join(dir, "collector.db");

try {
  await simulateRebuildFromBrokenDb(dbPath);
  if (!existsSync(dbPath)) {
    throw new Error("expected rebuilt collector.db to exist");
  }
  const verify = openDb(dbPath);
  const schema = await validateIndexSchema(verify);
  verify.close();
  if (!schema.ok) {
    throw new Error(`final schema invalid: ${schema.errors.join("; ")}`);
  }
  console.log("OK: broken index detected, rebuild path produces healthy DB");
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
