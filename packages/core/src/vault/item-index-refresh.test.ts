import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createVault } from "./vault-operations.js";
import { upsertItem, writeItemRawMarkdown } from "./item-operations.js";
import {
  isIndexAheadOfSnapshot,
  upsertItemIndexFromVault,
} from "./item-index-refresh.js";
import { createTag } from "./tag-operations.js";
import { createId } from "../util/ids.js";

describe("isIndexAheadOfSnapshot (#766)", () => {
  it("prefers content_revision then file_mtime_ms", () => {
    expect(
      isIndexAheadOfSnapshot(
        { content_revision: 3, file_mtime_ms: 100 },
        2,
        200,
      ),
    ).toBe(true);
    expect(
      isIndexAheadOfSnapshot(
        { content_revision: 2, file_mtime_ms: 300 },
        2,
        200,
      ),
    ).toBe(true);
    expect(
      isIndexAheadOfSnapshot(
        { content_revision: 2, file_mtime_ms: 100 },
        2,
        200,
      ),
    ).toBe(false);
  });
});

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
    const docPath = join(path, itemId);
    const stat = await fs.stat(docPath);
    if (stat.mtimeMs === null) {
      throw new Error("expected mtime on seeded item");
    }
    return { ctx, meta, path, itemId, item, fileMtimeMs: stat.mtimeMs };
  }

  it("upserts index rows from vault bytes", async () => {
    const { ctx, meta, path, itemId, fileMtimeMs } = await seedItem(2);
    await ctx.index.deleteItem(itemId);

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      2,
      fileMtimeMs,
    );
    expect(outcome).toBe("upserted");

    const indexed = await ctx.index.listItemFilesByIds(meta.id, [itemId]);
    expect(indexed[0]?.title).toBe("Note");
    expect(indexed[0]?.content_revision).toBe(2);
  });

  it("skips stale jobs when index already has a newer revision", async () => {
    const { ctx, meta, path, itemId, fileMtimeMs } = await seedItem(3);
    const upsertSpy = vi.spyOn(ctx.index, "upsertItem");

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      2,
      fileMtimeMs,
    );
    expect(outcome).toBe("stale");
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("skips when disk mtime is newer than job snapshot", async () => {
    const { ctx, meta, path, itemId } = await seedItem(1);
    const docPath = join(path, itemId);
    const stat = await fs.stat(docPath);
    if (stat.mtimeMs === null) {
      throw new Error("expected mtime");
    }
    const upsertSpy = vi.spyOn(ctx.index, "upsertItem");

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      1,
      stat.mtimeMs - 1,
    );
    expect(outcome).toBe("stale");
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("re-upserts when revision matches but metadata may have changed", async () => {
    const { ctx, meta, path, itemId, item, fileMtimeMs } = await seedItem(2);
    const upsertSpy = vi.spyOn(ctx.index, "upsertItem");

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      item.content_revision,
      fileMtimeMs,
    );
    expect(outcome).toBe("upserted");
    expect(upsertSpy).toHaveBeenCalled();
  });

  it("removes index row when vault item is missing", async () => {
    const { ctx, meta, path, itemId, fileMtimeMs } = await seedItem(1);
    await ctx.fs.remove(join(path, itemId));

    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      1,
      fileMtimeMs,
    );
    expect(outcome).toBe("missing");
    expect(await ctx.index.listItemFilesByIds(meta.id, [itemId])).toEqual([]);
  });

  it("upsertItemIndexFromVault syncs only item tags, not entire vault (#776)", async () => {
    const { ctx, meta, path, itemId, fileMtimeMs } = await seedItem(2);
    await createTag(ctx, path, meta.id, { name: "unused-a" });
    await createTag(ctx, path, meta.id, { name: "unused-b" });
    await ctx.index.deleteItem(itemId);

    const upsertTagSpy = vi.spyOn(ctx.index, "upsertTag");
    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      2,
      fileMtimeMs,
    );
    expect(outcome).toBe("upserted");
    expect(upsertTagSpy).not.toHaveBeenCalled();
    upsertTagSpy.mockRestore();
  });

  it("new tag is index-visible after derived job drain (#776)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-tag-after-job-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
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
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });
    await ctx.index.deleteItem(itemId);

    const raw = [
      "---",
      "title: Note",
      "description: edited",
      "type: note",
      "tags:",
      "  - brand-new",
      "content_revision: 2",
      `created: ${createdAt}`,
      `updated: ${createdAt}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await writeItemRawMarkdown(ctx, path, meta.id, itemId, raw);

    const stat = await fs.stat(join(path, itemId));
    if (stat.mtimeMs === null) {
      throw new Error("expected mtime");
    }
    const upsertTagSpy = vi.spyOn(ctx.index, "upsertTag");
    const outcome = await upsertItemIndexFromVault(
      ctx,
      path,
      meta.id,
      itemId,
      2,
      stat.mtimeMs,
    );
    expect(outcome).toBe("upserted");

    expect(upsertTagSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "brand-new" }),
      meta.id,
    );
    upsertTagSpy.mockRestore();

    const indexed = await ctx.index.listItemFilesByIds(meta.id, [itemId]);
    expect(indexed[0]?.title).toBe("Note");
    expect(indexed[0]?.tag_ids.length).toBe(1);
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
      fileMtimeMs: number;
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
          fileMtimeMs: number,
          itemUrl?: string | null,
        ) => {
          enqueued.push({
            vaultId,
            vaultPath,
            itemId,
            contentRevision,
            fileMtimeMs,
            ...(itemUrl !== undefined ? { itemUrl } : {}),
          });
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

    const stat = await fs.stat(join(path, itemId));
    if (stat.mtimeMs === null) {
      throw new Error("expected mtime");
    }
    expect(enqueued).toEqual([
      {
        vaultId: meta.id,
        vaultPath: path,
        itemId,
        contentRevision: 4,
        fileMtimeMs: stat.mtimeMs,
      },
    ]);
    expect(await ctx.index.listItemFilesByIds(meta.id, [itemId])).toEqual([]);
  });

  it("writeItemRawMarkdown enqueues derived refresh without inline index upsert", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-raw-enqueue-"));
    const sql = new MemorySqlAdapter();
    const enqueued: Array<{ itemId: string; fileMtimeMs: number }> = [];
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(sql),
      itemDerivedRefreshJobs: {
        enqueue: async (
          _vaultId: string,
          _vaultPath: string,
          itemId: string,
          _contentRevision: number,
          fileMtimeMs: number,
        ) => {
          enqueued.push({ itemId, fileMtimeMs });
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
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.itemId).toBe(itemId);
    expect(enqueued[0]?.fileMtimeMs).toBeTypeOf("number");
    expect(await ctx.index.listItemFilesByIds(meta.id, [itemId])).toEqual([]);
  });

  it("writeItemRawMarkdown skips tag sync when derived jobs are wired (#776)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-raw-tag-defer-"));
    const sql = new MemorySqlAdapter();
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(sql),
      itemDerivedRefreshJobs: {
        enqueue: async () => undefined,
      },
    };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    await createTag(ctx, path, meta.id, { name: "alpha" });
    await createTag(ctx, path, meta.id, { name: "beta" });
    const itemId = `${createId()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
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
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });

    const upsertTagSpy = vi.spyOn(ctx.index, "upsertTag");
    const raw = [
      "---",
      "title: Note",
      "description: edited",
      "type: note",
      "tags:",
      "  - alpha",
      "content_revision: 2",
      `created: ${createdAt}`,
      `updated: ${createdAt}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await writeItemRawMarkdown(ctx, path, meta.id, itemId, raw);
    expect(upsertTagSpy).not.toHaveBeenCalled();
    upsertTagSpy.mockRestore();
  });

  it("writeItemRawMarkdown syncs only item tags on inline upsert path (#776)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-raw-tag-inline-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const alpha = await createTag(ctx, path, meta.id, { name: "alpha" });
    await createTag(ctx, path, meta.id, { name: "beta" });
    await createTag(ctx, path, meta.id, { name: "gamma" });
    const itemId = `${createId()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
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
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });

    const upsertTagSpy = vi.spyOn(ctx.index, "upsertTag");
    const raw = [
      "---",
      "title: Note",
      "description: edited",
      "type: note",
      "tags:",
      "  - alpha",
      "content_revision: 2",
      `created: ${createdAt}`,
      `updated: ${createdAt}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await writeItemRawMarkdown(ctx, path, meta.id, itemId, raw);
    const upsertedNames = upsertTagSpy.mock.calls.map(
      (call) => (call[0] as { name: string }).name,
    );
    expect(upsertedNames).toContain("alpha");
    expect(upsertedNames).not.toContain("beta");
    expect(upsertedNames).not.toContain("gamma");
    upsertTagSpy.mockRestore();
  });
});
