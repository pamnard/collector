import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  itemMarkdownPath,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  writeTagsFile,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud source canonical tags (#943)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function setupVaultAndCrud() {
    dataDir = await mkdtemp(
      join(tmpdir(), "collector-source-canonical-"),
    );
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

    return { ctx, crud, meta, path };
  }

  it("updateItemSource canonicalizes legacy tag names even when body unchanged", async () => {
    const { ctx, crud, meta, path } = await setupVaultAndCrud();
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
});
