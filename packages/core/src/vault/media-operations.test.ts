import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "../vault/vault-operations.js";
import { upsertItem } from "../vault/item-operations.js";
import {
  attachMediaFile,
  attachMediaFileFromPath,
  deleteMediaFile,
  listItemMediaWithPaths,
  replaceMediaFile,
} from "../vault/media-operations.js";
import { listMediaFiles } from "../vault/media-io.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import {
  itemMediaManifestPath,
  itemMediaRoot,
  joinSegments,
  noteUuidFromItemPath,
} from "../vault/paths.js";

describe("media operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("attaches under media/<uuid>/ without manifest; deletes from disk and index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Photo note",
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
      created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const media = await attachMediaFile(ctx, path, itemId, {
      filename: "cover.png",
      data: pngBytes,
    });

    expect(media.filename).toBe("cover.png");
    const listed = await listItemMediaWithPaths(ctx, path, itemId);
    expect(listed).toHaveLength(1);
    expect(await fs.exists(listed[0]!.absolute_path)).toBe(true);
    expect(listed[0]!.absolute_path.startsWith(itemMediaRoot(path, itemId))).toBe(
      true,
    );
    expect(itemMediaRoot(path, itemId)).toBe(
      joinSegments(path, "media", noteUuidFromItemPath(itemId)),
    );
    expect(await fs.exists(itemMediaManifestPath(path, itemId))).toBe(false);
    expect(
      await fs.exists(
        joinSegments(path, `${noteUuidFromItemPath(itemId)}.media`),
      ),
    ).toBe(false);

    await deleteMediaFile(ctx, path, itemId, media.id);
    expect(await listItemMediaWithPaths(ctx, path, itemId)).toHaveLength(0);
    expect(await fs.exists(itemMediaManifestPath(path, itemId))).toBe(false);
  });

  it("attachMediaFileFromPath copies source file onto disk", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-from-path-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Path attach",
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const sourcePath = join(dataDir, "source-clip.bin");
    const payload = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    await fs.writeBinary(sourcePath, payload);

    const media = await attachMediaFileFromPath(ctx, path, itemId, {
      filename: "clip.mp4",
      absolutePath: sourcePath,
    });
    expect(media.filename).toBe("clip.mp4");
    const listed = await listItemMediaWithPaths(ctx, path, itemId);
    expect(listed).toHaveLength(1);
    expect(await fs.readBinary(listed[0]!.absolute_path)).toEqual(payload);
  });

  it("lists bare shot.png dropped into media/<uuid>/ (#277/#279)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-bare-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `Inbox/${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Bare media",
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
      created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const root = itemMediaRoot(path, itemId);
    await fs.mkdir(root);
    await fs.writeBinary(
      joinSegments(root, "shot.png"),
      Uint8Array.from([1, 2, 3]),
    );

    const listed = await listMediaFiles(fs, path, itemId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.filename).toBe("shot.png");
  });

  it("replaces media bytes keeping stable id and created_at (#353)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-replace-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Photo note",
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
      created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const attached = await attachMediaFile(ctx, path, itemId, {
      filename: "old.png",
      data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const listedBefore = await listItemMediaWithPaths(ctx, path, itemId);
    const oldPath = listedBefore[0]!.absolute_path;
    const createdAt = listedBefore[0]!.created_at;

    const replaced = await replaceMediaFile(ctx, path, itemId, attached.id, {
      filename: "new.jpg",
      data: Uint8Array.from([1, 2, 3, 4]),
    });

    expect(replaced.id).toBe(attached.id);
    expect(replaced.created_at).toBe(createdAt);
    expect(replaced.filename).toBe("new.jpg");
    expect(replaced.media_type).toBe("image");

    const listed = await listItemMediaWithPaths(ctx, path, itemId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(attached.id);
    expect(listed[0]!.filename).toBe("new.jpg");
    expect(await fs.exists(listed[0]!.absolute_path)).toBe(true);
    expect(await fs.exists(oldPath)).toBe(false);

    await expect(
      replaceMediaFile(ctx, path, itemId, "missing-id", {
        filename: "x.png",
        data: Uint8Array.from([1]),
      }),
    ).rejects.toThrow(/Media not found/);
  });

  it("attaches when item exists on disk but is not yet in the index (#828)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-deferred-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `Inbox/${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Deferred index note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Inbox",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "m",
    });
    // Disk note remains; index row gone — models race before catch-up (#828).
    // (deferIndexRefresh still pins metadata today; drop the row explicitly.)
    await ctx.index.deleteItem(itemId);

    const [before] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(before).toBeUndefined();

    const media = await attachMediaFile(ctx, path, itemId, {
      filename: "dot.png",
      data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    expect(media.filename).toBe("dot.png");

    const [after] = await ctx.index.listItemSyncMetaByIds(meta.id, [itemId]);
    expect(after).toBeTruthy();
    expect(await listItemMediaWithPaths(ctx, path, itemId)).toHaveLength(1);
  });

  it("attachMediaFile is idempotent by content across different filenames", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-dedup-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Dedup note",
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const first = await attachMediaFile(ctx, path, itemId, {
      filename: "from-plugin.png",
      data: pngBytes,
    });
    const second = await attachMediaFile(ctx, path, itemId, {
      filename: "from-localize.png",
      data: pngBytes,
    });
    expect(second.id).toBe(first.id);
    expect(second.filename).toBe(first.filename);
    expect(await listItemMediaWithPaths(ctx, path, itemId)).toHaveLength(1);

    const other = await attachMediaFile(ctx, path, itemId, {
      filename: "other.png",
      data: Uint8Array.from([137, 80, 78, 71, 0, 0, 0, 0]),
    });
    expect(other.id).not.toBe(first.id);
    expect(await listItemMediaWithPaths(ctx, path, itemId)).toHaveLength(2);
  });

  it("skips readBinary when existing media sizeBytes differs from incoming", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-size-skip-"));
    const baseFs = new NodeFileSystemAdapter();
    let readBinaryCalls = 0;
    const trackingFs = new Proxy(baseFs, {
      get(target, prop, receiver) {
        if (prop === "readBinary") {
          return async (path: string) => {
            readBinaryCalls += 1;
            return target.readBinary(path);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const sql = new MemorySqlAdapter();
    const ctx = { fs: trackingFs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Size skip",
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    await attachMediaFile(ctx, path, itemId, {
      filename: "small.png",
      data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    readBinaryCalls = 0;

    const larger = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0,
    ]);
    const attached = await attachMediaFile(ctx, path, itemId, {
      filename: "large.png",
      data: larger,
    });
    expect(attached.filename).toBe("large.png");
    expect(readBinaryCalls).toBe(0);
    expect(await listItemMediaWithPaths(ctx, path, itemId)).toHaveLength(2);
  });

  it("fails loud when catch-up cannot place the item in the index (#828)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-index-miss-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `Inbox/${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Missing index row",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Inbox",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "m",
    });
    await index.deleteItem(itemId);

    // Simulate catch-up upsert that never lands a row (e.g. repeated stale TOCTOU).
    const realUpsertItem = index.upsertItem.bind(index);
    index.upsertItem = async () => undefined;
    try {
      await expect(
        attachMediaFile(ctx, path, itemId, {
          filename: "dot.png",
          data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
        }),
      ).rejects.toThrow(/Item not in index/);
    } finally {
      index.upsertItem = realUpsertItem;
    }
  });
});
