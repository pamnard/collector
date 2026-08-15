import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { ItemFile } from "@collector/shared";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "./sql-index.js";
import { createVault } from "../vault/vault-operations.js";

export type SqlIndexTestVault = Awaited<ReturnType<typeof createVault>>;

export type SqlIndexTestEnv = {
  fs: NodeFileSystemAdapter;
  dataDir: string;
  db: BetterSqliteMigrator;
  index: SqlVaultIndexStore;
  ctx: { fs: NodeFileSystemAdapter; index: SqlVaultIndexStore };
  vault: SqlIndexTestVault;
};

export type SqlIndexTestSuite = {
  registerCleanup: () => void;
  openVaultIndex: (
    tempPrefix: string,
    dbFileName?: string,
  ) => Promise<SqlIndexTestEnv>;
  openMemoryDataDir: (tempPrefix: string) => Promise<{
    dataDir: string;
    fs: NodeFileSystemAdapter;
  }>;
};

/** Shared disposable-index suite: temp dir + migrated BetterSqlite + vault. */
export function createSqlIndexTestSuite(): SqlIndexTestSuite {
  let dataDir = "";
  let db: BetterSqliteMigrator | null = null;
  const fs = new NodeFileSystemAdapter();

  async function cleanup(): Promise<void> {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  }

  return {
    registerCleanup() {
      afterEach(async () => {
        await cleanup();
      });
    },

    async openVaultIndex(
      tempPrefix: string,
      dbFileName = "collector.db",
    ): Promise<SqlIndexTestEnv> {
      dataDir = await mkdtemp(join(tmpdir(), tempPrefix));
      db = BetterSqliteMigrator.open(join(dataDir, dbFileName));
      await runMigrations(db);
      const index = new SqlVaultIndexStore(db);
      const ctx = { fs, index };
      const vault = await createVault(ctx, dataDir, { name: "Vault" });
      return { fs, dataDir, db, index, ctx, vault };
    },

    async openMemoryDataDir(tempPrefix: string) {
      dataDir = await mkdtemp(join(tmpdir(), tempPrefix));
      return { dataDir, fs };
    },
  };
}

/** Minimal note ItemFile for index tests; callers override as needed. */
export function noteItemFields(
  vaultId: string,
  id: string,
  overrides: Partial<ItemFile> = {},
): ItemFile {
  const timestamp =
    overrides.created_at ?? overrides.updated_at ?? new Date().toISOString();
  const base: ItemFile = {
    id,
    vault_id: vaultId,
    title: id,
    description: "",
    content_type: "note",
    source_type: "manual",
    metadata: {},
    properties: {},
    tag_ids: [],
    collection_ids: [],
    folder_path: "",
    content_revision: 1,
    word_count: 0,
    character_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return { ...base, ...overrides, id, vault_id: vaultId };
}
