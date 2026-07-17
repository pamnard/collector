import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault, upsertItem } from "../vault/operations.js";
import {
  attachMediaFile,
  deleteMediaFile,
  listItemMediaWithPaths,
} from "../vault/media-operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { itemMediaManifestPath } from "../vault/paths.js";

describe("media operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("attaches and deletes media files on disk and in index", async () => {
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
        is_archived: false,
        is_favorite: false,
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

    await deleteMediaFile(ctx, path, itemId, media.id);
    expect(await listItemMediaWithPaths(ctx, path, itemId)).toHaveLength(0);
    expect(await fs.exists(itemMediaManifestPath(path, itemId))).toBe(true);
  });
});
