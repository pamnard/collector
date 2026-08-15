import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  readItemFile,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  upsertItem,
  writeItemRawMarkdown,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud updateItem updated_at (#652)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("bumps updated_at on structured update and persists to vault + index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-update-item-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const staleUpdatedAt = "2020-01-01T00:00:00.000Z";

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
      created_at: staleUpdatedAt,
        updated_at: staleUpdatedAt,
      },
      content: "body",
    });

    // upsertItem always writes "now"; pin a stale updated_at so the bump is observable.
    const pinnedMarkdown = await readItemRawMarkdown(fs, path, itemId);
    const staleMarkdown = pinnedMarkdown.replace(
      /^updated:\s*.+$/m,
      `updated: ${staleUpdatedAt}`,
    );
    await writeItemRawMarkdown(ctx, path, meta.id, itemId, staleMarkdown);

    const before = await readItemFile(fs, path, itemId, meta.id);
    expect(before.updated_at).toBe(staleUpdatedAt);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
      } as never,
      () => "unused",
    );

    const updated = await crud.updateItem(itemId, { title: "After" });

    expect(updated.title).toBe("After");
    expect(updated.updated_at).not.toBe(staleUpdatedAt);
    expect(Date.parse(updated.updated_at)).toBeGreaterThan(
      Date.parse(staleUpdatedAt),
    );

    const fromDisk = await readItemFile(fs, path, itemId, meta.id);
    expect(fromDisk.updated_at).toBe(updated.updated_at);

    const raw = await readItemRawMarkdown(fs, path, itemId);
    expect(raw).toContain(`updated: ${updated.updated_at}`);

    const indexed = await index.listItemFilesByIds(meta.id, [itemId]);
    expect(indexed[0]?.updated_at).toBe(updated.updated_at);
  });
});
