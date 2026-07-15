import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { readItemFile } from "./item-io.js";
import { itemRoot } from "./paths.js";
import { createVault, upsertItem } from "./operations.js";
import { createTag, deleteTag } from "./tag-operations.js";

describe("tag operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("deleteTag updates only items with the tag from index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tag-delete-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const tag = await createTag(ctx, path, meta.id, { name: "Focus" });

    const taggedIds: string[] = [];
    const untouchedIds: string[] = [];
    const timestamp = new Date().toISOString();

    for (let i = 0; i < 5; i += 1) {
      const itemId = createId();
      const withTag = i < 3;
      if (withTag) {
        taggedIds.push(itemId);
      } else {
        untouchedIds.push(itemId);
      }

      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: `Item ${i}`,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          is_archived: i === 2,
          is_favorite: false,
          tag_ids: withTag ? [tag.id] : [],
          collection_ids: [],
          folder_path: "",
          created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }

    const readDirSpy = vi.spyOn(fs, "readDir");
    await deleteTag(ctx, path, meta.id, tag.id);
    expect(readDirSpy).not.toHaveBeenCalled();
    readDirSpy.mockRestore();

    for (const itemId of taggedIds) {
      const item = await readItemFile(fs, itemRoot(path, itemId));
      expect(item.tag_ids).toEqual([]);
    }

    for (const itemId of untouchedIds) {
      const item = await readItemFile(fs, itemRoot(path, itemId));
      expect(item.tag_ids).toEqual([]);
    }

    expect(await ctx.index.listItemIdsByTag(meta.id, tag.id)).toEqual([]);
  });
});
