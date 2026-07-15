import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import type { FileSystemAdapter } from "../adapters/types.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { buildFtsMatchQuery } from "../search/fts-query.js";
import {
  createVault,
  deleteItem,
  listItemsByIds,
  listItemsOnDisk,
  streamItemsByIds,
  syncIndexFromFilesystem,
  upsertItem,
} from "../vault/operations.js";
import { readItemFile, writeItemFile } from "../vault/item-io.js";
import { itemRoot } from "../vault/paths.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";

class CountingFileSystemAdapter implements FileSystemAdapter {
  statCount = 0;

  constructor(private readonly inner: FileSystemAdapter) {}

  join(...parts: string[]): string {
    return this.inner.join(...parts);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  readText(path: string): Promise<string> {
    return this.inner.readText(path);
  }

  writeText(path: string, content: string): Promise<void> {
    return this.inner.writeText(path, content);
  }

  readBinary(path: string): Promise<Uint8Array> {
    return this.inner.readBinary(path);
  }

  writeBinary(path: string, content: Uint8Array): Promise<void> {
    return this.inner.writeBinary(path, content);
  }

  mkdir(path: string): Promise<void> {
    return this.inner.mkdir(path);
  }

  readDir(path: string): Promise<string[]> {
    return this.inner.readDir(path);
  }

  async stat(path: string): Promise<{ mtimeMs: number | null }> {
    this.statCount += 1;
    return this.inner.stat(path);
  }

  touch(path: string): Promise<void> {
    return this.inner.touch(path);
  }

  remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.inner.remove(path, options);
  }
}

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
  });

  it("upserts item to disk and index; delete removes both", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
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

  it("listItemsByIds preserves order and skips missing items", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
      name: "Vault",
    });

    const itemIds = [createId(), createId(), createId()];
    const titles = ["Third", "First", "Second"];
    for (const [index, itemId] of itemIds.entries()) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: titles[index]!,
          description: "",
          content_type: "note",
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
    }

    const missingId = createId();
    const loaded = await listItemsByIds(ctx, path, [
      itemIds[2]!,
      missingId,
      itemIds[0]!,
      itemIds[1]!,
    ]);

    expect(loaded.map((item) => item.id)).toEqual([
      itemIds[2]!,
      itemIds[0]!,
      itemIds[1]!,
    ]);
    expect(loaded.map((item) => item.title)).toEqual([
      titles[2]!,
      titles[0]!,
      titles[1]!,
    ]);
  });

  it("streamItemsByIds invokes onItem for each id", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
      name: "Vault",
    });

    const itemIds = [createId(), createId()];
    for (const itemId of itemIds) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: `Item ${itemId.slice(0, 4)}`,
          description: "",
          content_type: "note",
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
    }

    const seen = new Map<string, ItemFile>();
    await streamItemsByIds(ctx, path, itemIds, {
      onItem: ({ itemId, item }) => {
        if (item) {
          seen.set(itemId, item);
        }
      },
    });

    expect([...seen.keys()].sort()).toEqual([...itemIds].sort());
  });

  it("rebuilds index from filesystem", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
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

    // Удаляем из индекса, чтобы проверить восстановление индекса из файлов на диске
    await ctx.index.deleteItem(itemId);

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.indexed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toHaveLength(0);
  });

  it("skips sync when directory mtime matches the index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = createId();
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "hello",
    });

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.skipped).toBe(1);
    expect(report.indexed).toBe(0);
    expect(report.patched).toBe(0);
  });

  it("patches mtime when metadata matches but mtime drifted", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = createId();
    const timestamp = new Date().toISOString();

    const item = await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "hello",
    });

    await ctx.index.patchItemSyncMeta(itemId, {
      fileMtimeMs: 1,
      updatedAt: item.updated_at,
      contentRevision: item.content_revision,
    });

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.patched).toBe(1);
    expect(report.indexed).toBe(0);
    expect(report.skipped).toBe(0);
  });

  it("reindexes when content revision changes on disk", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = createId();
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "hello",
    });

    const itemPath = itemRoot(path, itemId);
    const onDisk = await readItemFile(fs, itemPath);
    await writeItemFile(fs, itemPath, {
      ...onDisk,
      content_revision: onDisk.content_revision + 1,
    });

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.indexed).toBe(1);
    expect(report.patched).toBe(0);
  });

  it("reports progress and batch callbacks while indexing an empty index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const diskCtx = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
    };
    const { meta, path } = await createVault(diskCtx, dataDir, { name: "Vault" });

    const itemCount = 40;
    for (let i = 0; i < itemCount; i += 1) {
      await upsertItem(diskCtx, path, meta.id, {
        item: {
          id: createId(),
          vault_id: meta.id,
          title: `Note ${i}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          is_archived: false,
          is_favorite: false,
          tag_ids: [],
          collection_ids: [],
          folder_path: i % 5 === 0 ? "Imports" : "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        content: `body ${i}`,
      });
    }

    const emptyCtx = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
    };
    await emptyCtx.index.upsertVault(meta, path);

    const batches: Array<{ processed: number; total: number; indexed: number }> =
      [];
    const report = await syncIndexFromFilesystem(emptyCtx, path, meta.id, {
      onBatch: (progress) => {
        batches.push({
          processed: progress.processed,
          total: progress.total,
          indexed: progress.indexed,
        });
      },
    });

    expect(report.indexed).toBe(itemCount);
    expect(report.contentIndexed).toBe(itemCount);
    expect(report.errors).toHaveLength(0);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches[0]?.total).toBe(itemCount);
    expect(batches.at(-1)?.indexed).toBe(itemCount);
    expect(await emptyCtx.index.listVaultItemIds(meta.id)).toHaveLength(
      itemCount,
    );
  });

  it("fills list from metadata phase before content/FTS completes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-phased-"));
    const diskCtx = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
    };
    const { meta, path } = await createVault(diskCtx, dataDir, { name: "Vault" });

    const titleToken = "PhaseTitleUnique";
    const contentToken = "PhaseBodyUniqueZz9";
    const itemId = createId();
    await upsertItem(diskCtx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: `${titleToken} note`,
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        folder_path: "Imports",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: `hello ${contentToken} world`,
    });

    const dbPath = join(dataDir, "collector.db");
    const db = BetterSqliteMigrator.open(dbPath);
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    await index.upsertVault(meta, path);

    let metadataSnapshot: {
      ids: string[];
      contentIndexed: number;
      titleHits: string[];
      contentHits: string[];
    } | null = null;

    const report = await syncIndexFromFilesystem({ fs, index }, path, meta.id, {
      onMetadataComplete: async (progress) => {
        const titleQuery = buildFtsMatchQuery(titleToken);
        const contentQuery = buildFtsMatchQuery(contentToken);
        metadataSnapshot = {
          ids: await index.listVaultItemIds(meta.id),
          contentIndexed: progress.contentIndexed,
          titleHits: titleQuery
            ? await index.searchItemIds(meta.id, titleQuery, "all")
            : [],
          contentHits: contentQuery
            ? await index.searchItemIds(meta.id, contentQuery, "all")
            : [],
        };
      },
    });

    expect(metadataSnapshot).not.toBeNull();
    expect(metadataSnapshot!.contentIndexed).toBe(0);
    expect(metadataSnapshot!.ids).toEqual([itemId]);
    expect(metadataSnapshot!.titleHits).toEqual([itemId]);
    expect(metadataSnapshot!.contentHits).toEqual([]);

    expect(report.indexed).toBe(1);
    expect(report.contentIndexed).toBe(1);
    expect(report.errors).toHaveLength(0);

    const contentQuery = buildFtsMatchQuery(contentToken);
    expect(contentQuery).not.toBeNull();
    expect(await index.searchItemIds(meta.id, contentQuery!, "all")).toEqual([
      itemId,
    ]);
    expect(await index.listItemIdsByFolderPrefix(meta.id, "Imports")).toEqual([
      itemId,
    ]);

    db.close();
  });

  it("indexes only new disk items when index is partially populated", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: createId(),
        vault_id: meta.id,
        title: "Existing",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "old",
    });

    const newId = createId();
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: newId,
        vault_id: meta.id,
        title: "New on disk",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "new",
    });
    await ctx.index.deleteItem(newId);

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.skipped).toBe(1);
    expect(report.indexed).toBe(1);
    expect(await ctx.index.listVaultItemIds(meta.id)).toContain(newId);
  });

  it("removes index rows for items deleted from disk offline", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = createId();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Gone",
        description: "",
        content_type: "note",
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

    await fs.remove(itemRoot(path, itemId), { recursive: true });

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.removed).toBe(1);
    expect(await ctx.index.listVaultItemIds(meta.id)).toHaveLength(0);
  });

  it("reindexes folder_path changes made offline", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = createId();
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Moved",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        folder_path: "Old",
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "x",
    });

    const itemPath = itemRoot(path, itemId);
    const onDisk = await readItemFile(fs, itemPath);
    await writeItemFile(fs, itemPath, {
      ...onDisk,
      folder_path: "New/Branch",
      content_revision: onDisk.content_revision + 1,
    });

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.indexed).toBe(1);

    const counts = await ctx.index.listFolderItemCounts(meta.id);
    expect(counts.find((row) => row.folder_path === "New/Branch")?.item_count).toBe(
      1,
    );
    expect(counts.find((row) => row.folder_path === "Old")).toBeUndefined();
  });

  it("handles empty vault sync without errors", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Empty" });

    const progress: Array<{ processed: number; total: number }> = [];
    const report = await syncIndexFromFilesystem(ctx, path, meta.id, {
      onProgress: (p) => progress.push({ processed: p.processed, total: p.total }),
    });

    expect(report.indexed).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(progress.at(-1)).toEqual({ processed: 0, total: 0 });
  });

  it("skips per-item stat on fingerprint hit for unchanged vault", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-fp-hit-"));
    const countingFs = new CountingFileSystemAdapter(fs);
    const sql = new MemorySqlAdapter();
    const ctx = { fs: countingFs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemCount = 8;

    for (let i = 0; i < itemCount; i += 1) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: createId(),
          vault_id: meta.id,
          title: `Note ${i}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          is_archived: false,
          is_favorite: false,
          tag_ids: [],
          collection_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        content: `body ${i}`,
      });
    }

    const warmup = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(warmup.skipped).toBe(itemCount);
    expect(warmup.errors).toHaveLength(0);
    expect(await ctx.index.getReconcileFingerprint(meta.id)).not.toBeNull();

    countingFs.statCount = 0;
    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.skipped).toBe(itemCount);
    expect(report.indexed).toBe(0);
    expect(report.patched).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(countingFs.statCount).toBe(1);
  });

  it("runs slow reconcile on fingerprint mismatch", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-fp-miss-"));
    const countingFs = new CountingFileSystemAdapter(fs);
    const sql = new MemorySqlAdapter();
    const ctx = { fs: countingFs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = createId();
    const timestamp = new Date().toISOString();

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: "hello",
    });

    const warmup = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(warmup.skipped).toBe(1);
    expect(warmup.errors).toHaveLength(0);

    await ctx.index.setReconcileFingerprint(meta.id, {
      itemsDirMtimeMs: 0,
      itemCount: 0,
    });

    countingFs.statCount = 0;
    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.skipped).toBe(1);
    expect(report.indexed).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(countingFs.statCount).toBeGreaterThan(1);
  });

  it("runs full reconcile when index is empty but vault has items", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-fp-empty-index-"));
    const diskCtx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(diskCtx, dataDir, { name: "Vault" });

    await upsertItem(diskCtx, path, meta.id, {
      item: {
        id: createId(),
        vault_id: meta.id,
        title: "On disk",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "body",
    });

    const emptyCtx = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
    };
    await emptyCtx.index.upsertVault(meta, path);

    const report = await syncIndexFromFilesystem(emptyCtx, path, meta.id);
    expect(report.indexed).toBe(1);
    expect(report.skipped).toBe(0);
    expect(await emptyCtx.index.getReconcileFingerprint(meta.id)).not.toBeNull();
  });
});
