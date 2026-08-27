import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId } from "../util/ids.js";
import { upsertItem, writeItemRawMarkdown } from "./item-operations.js";
import { createVault } from "./vault-operations.js";
import { listTagsWithCounts } from "./tag-operations.js";
import * as tagOperations from "./tag-operations.js";

describe("tag operations (#842)", () => {
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

  it("does not export reverse-direction catalog mutators", () => {
    expect(tagOperations).not.toHaveProperty("createTag");
    expect(tagOperations).not.toHaveProperty("deleteTag");
    expect(tagOperations).not.toHaveProperty("updateTag");
  });

  it("listTagsWithCounts follows document frontmatter assign and clear", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tags-derived-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const itemId = `${createId()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";
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
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });

    expect(await listTagsWithCounts(ctx, meta.id)).toEqual([]);

    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      [
        "---",
        "title: Note",
        "type: note",
        "tags:",
        "  - Research",
        "content_revision: 2",
        `created: ${createdAt}`,
        `updated: ${createdAt}`,
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    );

    const withTag = await listTagsWithCounts(ctx, meta.id);
    expect(withTag).toHaveLength(1);
    expect(withTag[0]?.name).toBe("Research");
    expect(withTag[0]?.item_count).toBe(1);

    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      [
        "---",
        "title: Note",
        "type: note",
        "tags: []",
        "content_revision: 3",
        `created: ${createdAt}`,
        `updated: ${createdAt}`,
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    );

    expect(await listTagsWithCounts(ctx, meta.id)).toEqual([]);
  });

  it("omits orphan catalog rows with item_count 0 from aggregated list", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tags-orphan-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const orphan = {
      id: createId(),
      name: "Orphan",
      color: null as string | null,
      created_at: "2024-01-01T00:00:00.000Z",
    };
    await ctx.index.upsertTag(orphan, meta.id);

    expect(await listTagsWithCounts(ctx, meta.id)).toEqual([]);
  });
});
