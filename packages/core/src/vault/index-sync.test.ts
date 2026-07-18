import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import type { VaultIndexAdapter } from "../adapters/types.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId } from "../util/ids.js";
import { createVault, upsertItem } from "../vault/operations.js";
import { createTag } from "../vault/tag-operations.js";
import { syncVaultIndexFromFilesystem } from "../vault/index-sync.js";

function createNoopVaultIndex(): VaultIndexAdapter {
  const noop = async () => {};
  return {
    upsertVault: noop,
    deleteVault: noop,
    upsertItem: noop,
    upsertItemMetadata: noop,
    upsertItemMetadataBatch: noop,
    upsertItemContent: noop,
    upsertItemContentBatch: noop,
    deleteItem: noop,
    upsertMedia: noop,
    deleteMedia: noop,
    deleteMediaForItem: noop,
    upsertTag: noop,
    deleteTag: noop,
    listTagsWithCounts: async () => [],
    listItemIdsByTag: async () => [],
    listItemIdsByFolderPrefix: async () => [],
    listItemIdsByNavFilter: async () => [],
    countItemIdsByNavFilter: async () => 0,
    listFolderItemCounts: async () => [],
    listVaultItemIds: async () => [],
    listItemFilesByIds: async () => [],
    listVaultItemSyncMeta: async () => [],
    patchItemSyncMeta: noop,
    patchItemSyncMetaBatch: noop,
    getReconcileFingerprint: async () => null,
    setReconcileFingerprint: noop,
    searchItemIds: async () => [],
    countSearchItemIds: async () => 0,
  };
}

describe("syncVaultIndexFromFilesystem", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("rebuilds vault row, tags, and items in an empty SQLite index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-index-sync-"));
    const diskCtx = { fs, index: createNoopVaultIndex() };
    const { meta, path } = await createVault(diskCtx, dataDir, {
      name: "Disk Vault",
      isDefault: true,
    });

    const tag = await createTag(diskCtx, path, meta.id, { name: "inbox" });
    const itemId = `${createId()}.md`;
    await upsertItem(diskCtx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Saved link",
        description: "",
        url: "https://example.com",
        content_type: "bookmark",
        source_type: "manual",
        metadata: {},
        tag_ids: [tag.id],
        collection_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "Example content",
    });

    const dbPath = join(dataDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);

    const report = await syncVaultIndexFromFilesystem({ fs, index }, path);
    expect(report.vaultId).toBe(meta.id);
    expect(report.indexed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.patched).toBe(0);
    expect(report.errors).toHaveLength(0);

    const vaultRows = await db.select<{ id: string }>(
      "SELECT id FROM vaults WHERE id = ?",
      [meta.id],
    );
    expect(vaultRows).toHaveLength(1);

    const tagRows = await db.select<{ id: string }>(
      "SELECT id FROM tags WHERE vault_id = ?",
      [meta.id],
    );
    expect(tagRows).toHaveLength(1);

    const itemRows = await db.select<{ id: string }>(
      "SELECT id FROM items WHERE vault_id = ?",
      [meta.id],
    );
    expect(itemRows).toHaveLength(1);

    const itemTagRows = await db.select<{ item_id: string }>(
      "SELECT item_id FROM item_tags WHERE item_id = ? AND tag_id = ?",
      [itemId, tag.id],
    );
    expect(itemTagRows).toHaveLength(1);

    db.close();
  });

  it("exposes paginated SQL ids before sync completes on an empty index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-index-sync-page-"));
    const diskCtx = { fs, index: createNoopVaultIndex() };
    const { meta, path } = await createVault(diskCtx, dataDir, {
      name: "Paged Vault",
      isDefault: true,
    });

    const itemCount = 25;
    for (let i = 0; i < itemCount; i += 1) {
      await upsertItem(diskCtx, path, meta.id, {
        item: {
          id: `${createId()}.md`,
          vault_id: meta.id,
          title: `Item ${i}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        content: `body ${i}`,
      });
    }

    const dbPath = join(dataDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    await index.upsertVault(meta, path);

    expect(await index.listItemIdsByNavFilter(meta.id, "all", { limit: 60, offset: 0 })).toEqual([]);
    expect(await index.countItemIdsByNavFilter(meta.id, "all")).toBe(0);

    let metadataComplete = false;
    await syncVaultIndexFromFilesystem({ fs, index }, path, {
      onMetadataComplete: () => {
        metadataComplete = true;
      },
    });

    expect(metadataComplete).toBe(true);
    const page = await index.listItemIdsByNavFilter(meta.id, "all", {
      limit: 60,
      offset: 0,
    });
    expect(page.length).toBe(itemCount);
    expect(await index.countItemIdsByNavFilter(meta.id, "all")).toBe(itemCount);

    db.close();
  });
});
