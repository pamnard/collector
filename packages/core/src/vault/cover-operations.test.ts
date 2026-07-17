import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault, upsertItem } from "../vault/operations.js";
import {
  applyItemCover,
  clearItemCover,
  resolveItemThumbnailAbsolutePath,
} from "./cover-operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { itemCoverPath, itemCoverRelativePath } from "./paths.js";
import { readItemFile } from "./item-io.js";

describe("cover operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("stores cover.webp and updates item thumbnail in index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-cover-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Photo",
        description: "",
        content_type: "image",
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

    const coverBytes = new TextEncoder().encode("fake-webp");
    const updated = await applyItemCover(ctx, path, meta.id, itemId, coverBytes);

    expect(updated.thumbnail).toBe(itemCoverRelativePath(itemId));
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(true);

    const resolved = resolveItemThumbnailAbsolutePath(path, itemId, updated.thumbnail);
    expect(resolved).toBe(itemCoverPath(path, itemId));
    expect(await fs.readBinary(resolved!)).toEqual(coverBytes);

    const cleared = await clearItemCover(ctx, path, meta.id, itemId);
    expect(cleared.thumbnail).toBeNull();
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(false);
    expect((await readItemFile(fs, path, itemId, meta.id)).thumbnail).toBeNull();
  });
});
