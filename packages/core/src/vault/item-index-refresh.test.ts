import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createVault } from "./vault-operations.js";
import { upsertItem, writeItemRawMarkdown } from "./item-operations.js";
import { upsertItemIndexFromVault } from "./item-index-refresh.js";
import { createId } from "../util/ids.js";

describe("upsertItemIndexFromVault (#766)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedItem(contentRevision = 1) {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-index-refresh-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    const item = await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        content_revision: contentRevision,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "body",
    });
    return { ctx, meta, path, itemId, item };
  }

  it("upserts index rows from vault bytes", async () => {
    const { ctx, meta, path, itemId } = await seedItem(2);
    await ctx.index.deleteItem(itemId);

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      2,
    );
    expect(outcome).toBe("upserted");

    const indexed = await ctx.index.listItemFilesByIds(meta.id, [itemId]);
    expect(indexed[0]?.title).toBe("Note");
    expect(indexed[0]?.content_revision).toBe(2);
  });

  it("skips stale jobs when index already has a newer revision", async () => {
    const { ctx, meta, path, itemId } = await seedItem(3);
    const upsertSpy = vi.spyOn(ctx.index, "upsertItem");

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      2,
    );
    expect(outcome).toBe("stale");
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("re-upserts when revision matches but metadata may have changed", async () => {
    const { ctx, meta, path, itemId, item } = await seedItem(2);
    const upsertSpy = vi.spyOn(ctx.index, "upsertItem");

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      item.content_revision,
    );
    expect(outcome).toBe("upserted");
    expect(upsertSpy).toHaveBeenCalled();
  });

  it("removes index row when vault item is missing", async () => {
    const { ctx, meta, path, itemId } = await seedItem(1);
    await ctx.fs.remove(join(path, itemId));

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      1,
    );
    expect(outcome).toBe("missing");
    expect(await ctx.index.listItemFilesByIds(meta.id, [itemId])).toEqual([]);
  });
});

describe("refreshItemIndexAfterWrite (#766)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("enqueues when itemDerivedRefreshJobs is set", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-index-enqueue-"));
    const sql = new MemorySqlAdapter();
    const enqueued: Array<{
      vaultId: string;
      vaultPath: string;
      itemId: string;
      contentRevision: number;
    }> = [];
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(sql),
      itemDerivedRefreshJobs: {
        enqueue: async (
          vaultId: string,
          vaultPath: string,
          itemId: string,
          contentRevision: number,
        ) => {
          enqueued.push({ vaultId, vaultPath, itemId, contentRevision });
        },
      },
    };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Queued",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        content_revision: 4,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "queued",
    });

    expect(enqueued).toEqual([
      {
        vaultId: meta.id,
        vaultPath: path,
        itemId,
        contentRevision: 4,
      },
    ]);
    expect(await ctx.index.listItemFilesByIds(meta.id, [itemId])).toEqual([]);
  });

  it("writeItemRawMarkdown enqueues derived refresh without inline index upsert", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-raw-enqueue-"));
    const sql = new MemorySqlAdapter();
    const enqueued: string[] = [];
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(sql),
      itemDerivedRefreshJobs: {
        enqueue: async (
          _vaultId: string,
          _vaultPath: string,
          itemId: string,
        ) => {
          enqueued.push(itemId);
        },
      },
    };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Before",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "old",
    });
    enqueued.length = 0;
    await ctx.index.deleteItem(itemId);

    const raw = [
      "---",
      "title: After",
      "description: edited",
      "type: note",
      "content_revision: 2",
      `created: ${createdAt}`,
      `updated: ${createdAt}`,
      "---",
      "",
      "new body",
      "",
    ].join("\n");

    await writeItemRawMarkdown(ctx, path, meta.id, itemId, raw);
    expect(enqueued).toEqual([itemId]);
    expect(await ctx.index.listItemFilesByIds(meta.id, [itemId])).toEqual([]);
  });
});
