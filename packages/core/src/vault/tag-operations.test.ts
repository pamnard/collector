import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId, nowIso } from "../util/ids.js";
import { ensureTagsByName } from "./item-io.js";
import { upsertItem } from "./item-operations.js";
import { createVault } from "./vault-operations.js";
import { listTagsWithCounts, syncTagsToIndex } from "./tag-operations.js";
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

  it("listTagsWithCounts reflects tags created via document-write ensure path", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tags-derived-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const maps = await ensureTagsByName(fs, path, ["Research"]);
    const tag = maps.byName.get("research");
    expect(tag).toBeDefined();
    await syncTagsToIndex(ctx, path, meta.id, { tagIds: [tag!.id] });

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
        properties: {},
        tag_ids: [tag!.id],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
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
