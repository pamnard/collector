/**
 * Vault-on-disk + empty index must sync without FK errors (issue #47).
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../packages/db/dist/migrate.js";
import { BetterSqliteMigrator } from "../packages/db/dist/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../packages/core/dist/adapters/node-fs.js";
import { SqlVaultIndexStore } from "../packages/core/dist/index/sql-index.js";
import { syncVaultIndexFromFilesystem } from "../packages/core/dist/vault/index-sync.js";

import { randomUUID } from "node:crypto";

const fs = new NodeFileSystemAdapter();
const vaultId = randomUUID();
const tagId = randomUUID();
const itemId = randomUUID();
const now = new Date().toISOString();

async function writeVaultOnDisk(dataDir) {
  const vaultPath = join(dataDir, "vaults", vaultId);
  const itemPath = join(vaultPath, "items", itemId);
  mkdirSync(join(vaultPath, "items"), { recursive: true });
  mkdirSync(join(itemPath, "media"), { recursive: true });

  writeFileSync(
    join(vaultPath, "vault.meta.json"),
    JSON.stringify(
      {
        id: vaultId,
        name: "Smoke Vault",
        description: "",
        is_default: true,
        schema_version: 2,
        settings: {},
        created_at: now,
        updated_at: now,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(vaultPath, "tags.json"),
    JSON.stringify(
      {
        tags: [{ id: tagId, name: "inbox", color: null, created_at: now }],
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(vaultPath, "folders.json"),
    JSON.stringify({ paths: [] }, null, 2),
  );

  writeFileSync(
    join(itemPath, "item.json"),
    JSON.stringify(
      {
        id: itemId,
        vault_id: vaultId,
        title: "Smoke item",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [tagId],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        schema_version: 2,
        created_at: now,
        updated_at: now,
      },
      null,
      2,
    ),
  );

  writeFileSync(join(itemPath, "content.md"), "# Smoke");
  return vaultPath;
}

const dir = mkdtempSync(join(tmpdir(), "collector-vault-index-smoke-"));
const dbPath = join(dir, "collector.db");

try {
  const vaultPath = await writeVaultOnDisk(dir);
  const db = BetterSqliteMigrator.open(dbPath);
  await runMigrations(db);
  const index = new SqlVaultIndexStore(db);

  const report = await syncVaultIndexFromFilesystem({ fs, index }, vaultPath);
  if (report.errors.length > 0) {
    throw new Error(`sync errors: ${report.errors.map((e) => e.message).join("; ")}`);
  }

  const vaultCount = await db.select("SELECT COUNT(*) AS count FROM vaults");
  const tagCount = await db.select("SELECT COUNT(*) AS count FROM tags");
  const itemCount = await db.select("SELECT COUNT(*) AS count FROM items");
  db.close();

  if (vaultCount[0]?.count !== 1 || tagCount[0]?.count !== 1 || itemCount[0]?.count !== 1) {
    throw new Error(
      `expected 1 vault/tag/item, got vault=${vaultCount[0]?.count} tag=${tagCount[0]?.count} item=${itemCount[0]?.count}`,
    );
  }

  console.log("OK: empty index rebuilt from on-disk vault without FK errors");
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
