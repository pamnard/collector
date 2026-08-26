import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  upsertItem,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud metadata-only update (#776)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("title-only update does not invoke normalizeMarkdown on body bytes", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-metadata-only-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const dirtyBody = "line one  \nline two\n";

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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: dirtyBody,
    });

    const beforeRaw = await readItemRawMarkdown(fs, path, itemId);
    const normalizeMarkdown = vi.fn((raw: string) => ({
      text: raw.replace(/  \n/g, "\n"),
      changed: true,
    }));

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown,
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => "unused",
    );

    await crud.updateItem(itemId, { title: "After" });

    expect(normalizeMarkdown).not.toHaveBeenCalled();
    const afterRaw = await readItemRawMarkdown(fs, path, itemId);
    expect(afterRaw).toContain(dirtyBody);
    expect(afterRaw).toContain("title: After");
  });
});
