import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "../vault/vault-operations.js";
import { upsertItem } from "../vault/item-operations.js";
import {
  applyItemCover,
  clearItemCover,
} from "./cover-operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { itemCoverPath } from "./paths.js";
import { readItemFile, writeItemFile } from "./item-io.js";

describe("cover operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("stores cover.webp on disk and does not write vault paths into frontmatter", async () => {
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
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const withStaleFm = await readItemFile(fs, path, itemId, meta.id);
    await writeItemFile(fs, path, {
      ...withStaleFm,
      thumbnail: `${itemId.replace(/\.md$/, "")}.media/cover.webp`,
    });

    const coverBytes = new TextEncoder().encode("fake-webp");
    const updated = await applyItemCover(ctx, path, meta.id, itemId, coverBytes);

    expect(updated.thumbnail).toBeNull();
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(true);
    expect(await fs.readBinary(itemCoverPath(path, itemId))).toEqual(coverBytes);

    const cleared = await clearItemCover(ctx, path, meta.id, itemId);
    expect(cleared.thumbnail).toBeNull();
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(false);
    expect((await readItemFile(fs, path, itemId, meta.id)).thumbnail).toBeNull();
  });
});
