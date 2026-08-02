import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "../vault/vault-operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";

describe("vault operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("creates vault on disk and in index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
      name: "My Vault",
      isDefault: true,
    });

    expect(meta.name).toBe("My Vault");
    expect(await fs.exists(path)).toBe(true);
    expect(await fs.exists(join(path, "vault.meta.json"))).toBe(true);
    expect(await fs.exists(join(path, INBOX_FOLDER_NAME))).toBe(true);
  });

});
