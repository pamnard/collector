import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId, nowIso } from "../util/ids.js";
import { readItemFile } from "./item-io.js";
import { createVault, upsertItem } from "./operations.js";
import { createTag, deleteTag, listTagsWithCounts } from "./tag-operations.js";
import { writeTagsFile } from "./tag-io.js";

describe("tag operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
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
      const itemId = `${createId()}.md`;
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
      const item = await readItemFile(fs, path, itemId, meta.id);
      expect(item.tag_ids).toEqual([]);
    }

    for (const itemId of untouchedIds) {
      const item = await readItemFile(fs, path, itemId, meta.id);
      expect(item.tag_ids).toEqual([]);
    }

    expect(await ctx.index.listItemIdsByTag(meta.id, tag.id)).toEqual([]);
  });

  it("listTagsWithCounts reads counts from index without tags.json", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tags-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const tagId = createId();
    const tag = {
      id: tagId,
      name: "Research",
      color: null as string | null,
      created_at: nowIso(),
    };
    await writeTagsFile(fs, path, { tags: [tag] });
    await ctx.index.upsertTag(tag, meta.id);

    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [tagId],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    });

    const tags = await listTagsWithCounts(ctx, meta.id);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.name).toBe("Research");
    expect(tags[0]?.item_count).toBe(1);
  });
});
