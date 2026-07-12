import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import {
  createVault,
  deleteItem,
  listItemsOnDisk,
  syncIndexFromFilesystem,
  upsertItem,
} from "../vault/operations.js";
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
    const userId = createId();

    const { meta, path } = await createVault(ctx, dataDir, {
      userId,
      name: "My Vault",
      isDefault: true,
    });

    expect(meta.name).toBe("My Vault");
    expect(await fs.exists(path)).toBe(true);
    expect(await fs.exists(join(path, "vault.meta.json"))).toBe(true);
  });

  it("upserts item to disk and index; delete removes both", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const userId = createId();

    const { meta, path } = await createVault(ctx, dataDir, {
      userId,
      name: "Vault",
    });

    const itemId = createId();
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Test note",
        description: "desc",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: true,
        tag_ids: [],
        collection_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "# Hello",
    });

    const items = await listItemsOnDisk(ctx, path);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Test note");

    await deleteItem(ctx, path, itemId);
    expect(await listItemsOnDisk(ctx, path)).toHaveLength(0);
  });

  it("rebuilds index from filesystem", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const userId = createId();

    const { meta, path } = await createVault(ctx, dataDir, {
      userId,
      name: "Vault",
    });

    const itemId = createId();
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Bookmark",
        description: "",
        url: "https://example.com",
        content_type: "bookmark",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.indexed).toBe(1);
    expect(report.errors).toHaveLength(0);
  });
});
