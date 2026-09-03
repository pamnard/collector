import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  ensureTagsByName,
  itemMarkdownPath,
  listTagsWithCounts,
  readItemRawMarkdown,
  readTagsFile,
  resolveOrCreateInboxFolder,
  upsertItem,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../db/src/testing/better-sqlite.js";
import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud source canonical (#948)", () => {
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

  it("updateItemSource no-op still syncs tag catalog and index from file bytes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-source-canonical-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";

    const tagMaps = await ensureTagsByName(fs, path, ["Index"]);
    const existingTag = tagMaps.byName.get("index");
    if (!existingTag) {
      throw new Error("expected seeded tag");
    }
    await index.upsertTag(existingTag, meta.id);

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Before",
        description: "",
        url: null,
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });

    const raw = [
      "---",
      "title: Before",
      "type: note",
      "tags:",
      "  - index",
      "content_revision: 1",
      `created: ${createdAt}`,
      `updated: ${createdAt}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await fs.writeText(itemMarkdownPath(path, itemId), raw);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (source) => ({ text: source, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => "unused",
    );

    const updated = await crud.updateItemSource(itemId, raw);

    expect(updated.tag_ids).toEqual([existingTag.id]);
    expect(await readItemRawMarkdown(fs, path, itemId)).toBe(raw);
    expect((await readTagsFile(fs, path)).tags).toEqual([
      expect.objectContaining({
        id: existingTag.id,
        name: "index",
      }),
    ]);

    const tags = await listTagsWithCounts(ctx, meta.id);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({
      id: existingTag.id,
      name: "index",
      item_count: 1,
    });
  });
});
