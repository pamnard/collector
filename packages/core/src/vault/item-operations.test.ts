import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  FileSystemAdapter,
  VaultItemMetaRead,
  VaultItemStatMeta,
} from "../adapters/types.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "../vault/vault-operations.js";
import {
  deleteItem,
  listItemsByIds,
  listItemsOnDisk,
  streamItemsByIds,
  upsertItem,
  syncItemFromDisk,
  writeItemCanonicalSourceMarkdown,
  writeItemRawMarkdown,
} from "../vault/item-operations.js";
import { readItemRawMarkdown } from "../vault/item-io.js";
import { itemMarkdownPath, itemMediaRoot } from "../vault/paths.js";
import { readTagsFile, writeTagsFile } from "../vault/tag-io.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { seedTagFromDocumentWritePath } from "../testing/seed-tag.js";
import { attachMediaFile } from "../vault/media-operations.js";

class CountingFileSystemAdapter implements FileSystemAdapter {
  statCount = 0;
  tagsJsonReadCount = 0;
  tagsJsonWriteCount = 0;

  constructor(private readonly inner: FileSystemAdapter) {}

  private isTagsJson(path: string): boolean {
    return path.endsWith("tags.json");
  }

  join(...parts: string[]): string {
    return this.inner.join(...parts);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  async readText(path: string): Promise<string> {
    if (this.isTagsJson(path)) {
      this.tagsJsonReadCount += 1;
    }
    return this.inner.readText(path);
  }

  async writeText(path: string, content: string): Promise<void> {
    if (this.isTagsJson(path)) {
      this.tagsJsonWriteCount += 1;
    }
    return this.inner.writeText(path, content);
  }

  writeTextExclusive(path: string, content: string): Promise<void> {
    return this.inner.writeTextExclusive(path, content);
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

  readDirEntries(path: string) {
    return this.inner.readDirEntries(path);
  }

  async stat(path: string): Promise<{ mtimeMs: number | null }> {
    this.statCount += 1;
    return this.inner.stat(path);
  }

  touch(path: string, mtimeMs?: number): Promise<void> {
    return this.inner.touch(path, mtimeMs);
  }

  remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.inner.remove(path, options);
  }

  rename(from: string, to: string): Promise<void> {
    return this.inner.rename(from, to);
  }

  async statVaultItemsMeta(vaultPath: string): Promise<VaultItemStatMeta[]> {
    if (!this.inner.statVaultItemsMeta) {
      throw new Error("inner adapter missing statVaultItemsMeta");
    }
    // Delegate: sync fingerprint tests count only adapter.stat, not batch reads.
    return this.inner.statVaultItemsMeta(vaultPath);
  }

  async readVaultItemsMeta(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemMetaRead[]> {
    const results: VaultItemMetaRead[] = [];
    for (const itemId of itemIds) {
      const docPath = itemMarkdownPath(vaultPath, itemId);
      if (!(await this.exists(docPath))) {
        continue;
      }
      const documentMarkdown = await this.readText(docPath);
      const fileStat = await this.stat(docPath);
      results.push({
        id: itemId,
        documentMarkdown,
        mtimeMs: fileStat.mtimeMs,
      });
    }
    return results;
  }
}

describe("item operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("upserts item to disk and index; delete removes both", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
      name: "Vault",
    });

    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Test note",
        description: "desc",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
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

    await attachMediaFile(ctx, path, itemId, {
      filename: "a.png",
      data: Uint8Array.from([1]),
    });
    const mediaRoot = itemMediaRoot(path, itemId);
    expect(await fs.exists(mediaRoot)).toBe(true);

    await deleteItem(ctx, path, itemId);
    expect(await listItemsOnDisk(ctx, path)).toHaveLength(0);
    expect(await fs.exists(mediaRoot)).toBe(false);
  });

  it("writes raw markdown as-is and reindexes from parse", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-raw-"));
    const sql = new MemorySqlAdapter();
    const enqueued: Array<{ vaultId: string; itemIds: string[] }> = [];
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(sql),
      embeddingRefreshJobs: {
        enqueue: async (vaultId: string, inputs: Array<{ itemId: string }>) => {
          enqueued.push({
            vaultId,
            itemIds: inputs.map((input) => input.itemId),
          });
        },
      },
    };
    const { meta, path } = await createVault(ctx, dataDir, {
      name: "Vault",
    });

    const itemId = `${createId()}.md`;
    const created = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Original",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        created_at: created,
        updated_at: created,
      },
      content: "old body",
    });

    const raw = [
      "---",
      "title: From source",
      "description: edited raw",
      "type: note",
      `created: ${created}`,
      `updated: ${created}`,
      "---",
      "",
      "# Source body",
      "",
      "kept verbatim spacing  ",
      "",
    ].join("\n");

    const updated = await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      raw,
    );
    expect(updated.title).toBe("From source");
    expect(updated.description).toBe("edited raw");

    const onDisk = await readItemRawMarkdown(fs, path, itemId);
    expect(onDisk).toBe(raw);

    const indexed = await listItemsByIds(ctx, path, [itemId]);
    expect(indexed[0]?.title).toBe("From source");
    expect(indexed[0]?.description).toBe("edited raw");
    expect(enqueued).toEqual([
      { vaultId: meta.id, itemIds: [itemId] },
      { vaultId: meta.id, itemIds: [itemId] },
    ]);
  });

  it("writeItemCanonicalSourceMarkdown rewrites legacy tag names in frontmatter (#943)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-canonical-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const legacyId = createId();
    const itemId = `${createId()}.md`;
    const created = "2024-01-01T00:00:00.000Z";
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: legacyId,
          name: "A/B",
          color: null,
          created_at: created,
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: legacyId,
        name: "A/B",
        color: null,
        created_at: created,
      },
      meta.id,
    );

    const raw = [
      "---",
      "title: Legacy",
      "type: note",
      "tags:",
      "  - A/B",
      `created: ${created}`,
      `updated: ${created}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await fs.mkdir(path);
    await fs.writeText(itemMarkdownPath(path, itemId), raw);
    await ctx.index.upsertItemMetadata(
      {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: "Legacy",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [legacyId],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: created,
          updated_at: created,
        },
        fileMtimeMs: Date.now(),
      },
      meta.id,
    );

    const { item, wrote } = await writeItemCanonicalSourceMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      raw,
    );
    expect(wrote).toBe(true);
    expect(item.tag_ids).toEqual([legacyId]);

    const onDisk = await readItemRawMarkdown(fs, path, itemId);
    expect(onDisk).toMatch(/tags:\s*\n\s*- ab/);
    expect(onDisk).not.toContain("A/B");
  });

  it("writeItemCanonicalSourceMarkdown skips write when frontmatter already canonical", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-canonical-skip-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemId = `${createId()}.md`;
    const created = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Canonical",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        created_at: created,
        updated_at: created,
      },
      content: "body",
    });

    const existing = await readItemRawMarkdown(fs, path, itemId);
    const { wrote } = await writeItemCanonicalSourceMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      existing,
    );
    expect(wrote).toBe(false);
  });

  it("writeItemCanonicalSourceMarkdown syncs index on wrote:false when catalog mutated (#948)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-canonical-noop-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const legacyId = createId();
    const itemId = `${createId()}.md`;
    const created = "2024-01-01T00:00:00.000Z";
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: legacyId,
          name: "A/B",
          color: null,
          created_at: created,
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: legacyId,
        name: "A/B",
        color: null,
        created_at: created,
      },
      meta.id,
    );

    const rawLegacy = [
      "---",
      "title: Legacy",
      "type: note",
      "tags:",
      "  - A/B",
      `created: ${created}`,
      `updated: ${created}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await fs.mkdir(path);
    await fs.writeText(itemMarkdownPath(path, itemId), rawLegacy);
    await ctx.index.upsertItemMetadata(
      {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: "Legacy",
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
          created_at: created,
          updated_at: created,
        },
        fileMtimeMs: Date.now(),
      },
      meta.id,
    );

    // First save rewrites FM to stored form.
    const first = await writeItemCanonicalSourceMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      rawLegacy,
    );
    expect(first.wrote).toBe(true);
    const canonical = await readItemRawMarkdown(fs, path, itemId);

    // Simulate drift: catalog back to legacy spelling, index loses item_tags.
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: legacyId,
          name: "A/B",
          color: null,
          created_at: created,
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: legacyId,
        name: "A/B",
        color: null,
        created_at: created,
      },
      meta.id,
    );
    await ctx.index.upsertItemMetadata(
      {
        item: {
          ...first.item,
          tag_ids: [],
        },
        fileMtimeMs: Date.now(),
      },
      meta.id,
    );

    const { item, wrote } = await writeItemCanonicalSourceMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      canonical,
    );
    expect(wrote).toBe(false);
    expect(item.tag_ids).toEqual([legacyId]);
    expect(await readItemRawMarkdown(fs, path, itemId)).toBe(canonical);
    expect((await readTagsFile(fs, path)).tags).toEqual([
      expect.objectContaining({ id: legacyId, name: "ab" }),
    ]);
    const indexed = await listItemsByIds(ctx, path, [itemId]);
    expect(indexed[0]?.tag_ids).toEqual([legacyId]);
  });

  it("syncItemFromDisk syncs catalog and index without rewriting markdown", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-sync-file-first-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
      name: "Vault",
    });

    const existingTag = await seedTagFromDocumentWritePath(
      ctx,
      path,
      meta.id,
      "focus",
    );
    const itemId = `${createId()}.md`;
    const created = "2024-01-01T00:00:00.000Z";
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Original",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        created_at: created,
        updated_at: created,
      },
      content: "body",
    });

    const raw = [
      "---",
      "title: Original",
      "type: note",
      "tags:",
      "  - focus",
      "content_revision: 1",
      `created: ${created}`,
      `updated: ${created}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await fs.writeText(itemMarkdownPath(path, itemId), raw);

    const synced = await syncItemFromDisk(ctx, path, meta.id, itemId);
    expect(synced.tag_ids).toEqual([existingTag.id]);
    expect(await readItemRawMarkdown(fs, path, itemId)).toBe(raw);

    const indexed = await listItemsByIds(ctx, path, [itemId]);
    expect(indexed[0]?.tag_ids).toEqual([existingTag.id]);
  });

  it("syncItemFromDisk short-circuits when catalog and index already match FM", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-sync-short-"));
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
    const tag = await seedTagFromDocumentWritePath(ctx, path, meta.id, "focus");
    const itemId = `${createId()}.md`;
    const created = "2024-01-01T00:00:00.000Z";
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
        tag_ids: [tag.id],
        collection_ids: [],
        created_at: created,
        updated_at: created,
      },
      content: "body",
    });
    enqueued.length = 0;

    const synced = await syncItemFromDisk(ctx, path, meta.id, itemId);
    expect(synced.tag_ids).toEqual([tag.id]);
    expect(enqueued).toEqual([]);
  });

  it("listItemsByIds preserves order and skips missing items", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-vault-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, {
      name: "Vault",
    });

    const itemIds = [`${createId()}.md`, `${createId()}.md`, `${createId()}.md`];
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
          properties: {},
          tag_ids: [],
          collection_ids: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }

    const missingId = `${createId()}.md`;
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

    const itemIds = [`${createId()}.md`, `${createId()}.md`];
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
          properties: {},
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

  it("streamItemsByIds reuses batch mtime and shared tag maps (#195)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-stream-batch-"));
    const countingFs = new CountingFileSystemAdapter(fs);
    const ctx = { fs: countingFs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemCount = 12;
    const itemIds: string[] = [];
    const timestamp = new Date().toISOString();

    for (let i = 0; i < itemCount; i += 1) {
      const itemId = `${createId()}.md`;
      itemIds.push(itemId);
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: `Note ${i}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          created_at: timestamp,
          updated_at: timestamp,
        },
        content: `body ${i}`,
      });
    }

    countingFs.statCount = 0;
    countingFs.tagsJsonReadCount = 0;
    const seen: ItemFile[] = [];
    await streamItemsByIds(ctx, path, itemIds, {
      onItem: ({ item }) => {
        if (item) {
          seen.push(item);
        }
      },
    });

    expect(seen).toHaveLength(itemCount);
    expect(countingFs.tagsJsonReadCount).toBe(1);
    expect(countingFs.statCount).toBe(itemCount);
  });

});
