import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import type { FileSystemAdapter, VaultItemMetaRead, VaultItemStatMeta } from "../adapters/types.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault, syncIndexFromFilesystem, upsertItem } from "./operations.js";
import { writeItemFile } from "./item-io.js";
import {
  hasVaultFsBatch,
  readVaultItemMetaBatch,
  statAllVaultItemMeta,
  VAULT_ITEM_READ_META_BATCH,
} from "./vault-fs-batch.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import * as concurrency from "../util/concurrency.js";

describe("vault-fs-batch", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("detects batch-capable adapters", () => {
    expect(hasVaultFsBatch(fs)).toBe(true);
    expect(hasVaultFsBatch({ join: () => "" } as FileSystemAdapter)).toBe(false);
  });

  it("statAllVaultItemMeta returns mtimes for every item dir", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-batch-stat-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Batch stat",
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

    const stats = await statAllVaultItemMeta(fs, path);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.id).toBe(itemId);
    expect(stats[0]?.mtimeMs).not.toBeNull();
  });

  it("readVaultItemMetaBatch chunks large id lists", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-batch-read-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemIds = Array.from(
      { length: VAULT_ITEM_READ_META_BATCH + 3 },
      () => `${createId()}.md`,
    );
    for (const itemId of itemIds) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: itemId,
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

    const readSpy = vi.spyOn(fs, "readVaultItemsMeta");
    const reads = await readVaultItemMetaBatch(fs, path, itemIds);
    expect(reads).toHaveLength(itemIds.length);
    expect(readSpy).toHaveBeenCalledTimes(
      Math.ceil(itemIds.length / VAULT_ITEM_READ_META_BATCH),
    );
    readSpy.mockRestore();
  });

  it("readVaultItemMetaBatch yields between IPC chunks", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-batch-read-yield-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemIds = Array.from(
      { length: VAULT_ITEM_READ_META_BATCH * 2 + 1 },
      () => `${createId()}.md`,
    );
    for (const itemId of itemIds) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: itemId,
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

    const yieldSpy = vi.spyOn(concurrency, "yieldToEventLoop");
    await readVaultItemMetaBatch(fs, path, itemIds);
    expect(yieldSpy).toHaveBeenCalled();
    yieldSpy.mockRestore();
  });

  it("sync uses one stat batch and batched meta reads", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-batch-sync-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemCount = 48;
    const timestamp = new Date().toISOString();
    for (let i = 0; i < itemCount; i += 1) {
      const itemId = `${createId()}.md`;
      await writeItemFile(ctx.fs, path, {
        id: itemId,
        vault_id: meta.id,
        title: `Item ${i}`,
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    const statSpy = vi.spyOn(fs, "statVaultItemsMeta");
    const readSpy = vi.spyOn(fs, "readVaultItemsMeta");

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.indexed).toBe(itemCount);
    expect(statSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledTimes(
      Math.ceil(itemCount / VAULT_ITEM_READ_META_BATCH),
    );

    statSpy.mockRestore();
    readSpy.mockRestore();
  });
});

class CountingBatchAdapter implements FileSystemAdapter {
  statCalls = 0;
  readCalls = 0;

  constructor(private readonly inner: NodeFileSystemAdapter) {}

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

  stat(path: string): Promise<{ mtimeMs: number | null }> {
    return this.inner.stat(path);
  }

  touch(path: string): Promise<void> {
    return this.inner.touch(path);
  }

  remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.inner.remove(path, options);
  }

  rename(from: string, to: string): Promise<void> {
    return this.inner.rename(from, to);
  }

  async statVaultItemsMeta(vaultPath: string): Promise<VaultItemStatMeta[]> {
    this.statCalls += 1;
    return this.inner.statVaultItemsMeta!(vaultPath);
  }

  async readVaultItemsMeta(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemMetaRead[]> {
    this.readCalls += 1;
    return this.inner.readVaultItemsMeta!(vaultPath, itemIds);
  }
}

describe("vault-fs-batch perf guard", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("indexes 200 items with O(1) stat IPC and few read IPC calls", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-batch-perf-"));
    const inner = new NodeFileSystemAdapter();
    const fs = new CountingBatchAdapter(inner);
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemCount = 200;
    const timestamp = new Date().toISOString();
    for (let i = 0; i < itemCount; i += 1) {
      const itemId = `${createId()}.md`;
      await writeItemFile(fs, path, {
        id: itemId,
        vault_id: meta.id,
        title: `Perf ${i}`,
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    const report = await syncIndexFromFilesystem(ctx, path, meta.id);
    expect(report.indexed).toBe(itemCount);

    expect(fs.statCalls).toBe(1);
    expect(fs.readCalls).toBeLessThanOrEqual(
      Math.ceil(itemCount / VAULT_ITEM_READ_META_BATCH),
    );
    expect(fs.readCalls).toBeLessThan(itemCount / 4);
  });
});
