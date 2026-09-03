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
  writeTagsFile,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../db/src/testing/better-sqlite.js";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud source canonical tags", () => {
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

  it("updateItemSource canonicalizes legacy tag names even when body unchanged (#943)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-source-canonical-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => crypto.randomUUID(),
    );

    const legacyId = crypto.randomUUID();
    const created = "2024-01-01T00:00:00.000Z";
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: legacyId,
          name: "A/B",
          color: null,
          created_at: created,
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: legacyId,
        name: "A/B",
        color: null,
        created_at: created,
      },
      meta.id,
    );

    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const raw = [
      "---",
      "title: Legacy",
      "type: note",
      "tags:",
      "  - A/B",
      `created: ${created}`,
      `updated: ${created}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
    await fs.mkdir(path);
    await fs.writeText(itemMarkdownPath(path, itemId), raw);
    await ctx.index.upsertItemMetadata(
      {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: "Legacy",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [legacyId],
          collection_ids: [],
          folder_path: folderPath,
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: created,
          updated_at: created,
        },
        fileMtimeMs: Date.now(),
      },
      meta.id,
    );

    await crud.updateItemSource(itemId, raw);

    const onDisk = await readItemRawMarkdown(fs, path, itemId);
    expect(onDisk).toMatch(/tags:\s*\n\s*- ab/);
    expect(onDisk).not.toContain("A/B");
  });

  it("updateItemSource no-op still syncs tag catalog and index from file bytes (#948)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-source-canonical-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const createdAt = "2024-01-01T00:00:00.000Z";

    const tagMaps = await ensureTagsByName(fs, path, ["focus"]);
    const existingTag = tagMaps.byName.get("focus");
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
        tag_ids: [existingTag.id],
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

    const canonical = await readItemRawMarkdown(fs, path, itemId);

    // Drift: index loses item_tags while disk stays canonical.
    const [current] = await index.listItemFilesByIds(meta.id, [itemId]);
    if (!current) {
      throw new Error("expected indexed item");
    }
    await index.upsertItemMetadata(
      {
        item: { ...current, tag_ids: [] },
        fileMtimeMs: Date.now(),
      },
      meta.id,
    );

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

    const updated = await crud.updateItemSource(itemId, canonical);

    expect(updated.tag_ids).toEqual([existingTag.id]);
    expect(await readItemRawMarkdown(fs, path, itemId)).toBe(canonical);
    expect((await readTagsFile(fs, path)).tags).toEqual([
      expect.objectContaining({
        id: existingTag.id,
        name: "focus",
      }),
    ]);

    const tags = await listTagsWithCounts(ctx, meta.id);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({
      id: existingTag.id,
      name: "focus",
      item_count: 1,
    });
  });
});
