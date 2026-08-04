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
});
