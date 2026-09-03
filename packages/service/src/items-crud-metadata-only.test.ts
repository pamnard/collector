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
  writeItemRawMarkdown,
  writeTagsFile,
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

  it("preserves raw frontmatter tag casing on metadata-only update (#949)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-metadata-tag-case-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const tagId = crypto.randomUUID();

    await writeTagsFile(fs, path, {
      tags: [
        {
          id: tagId,
          name: "Index",
          color: null,
          created_at: new Date().toISOString(),
        },
      ],
    });

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
        tag_ids: [tagId],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "body",
    });

    const seededRaw = await readItemRawMarkdown(fs, path, itemId);
    const rawWithLowercaseTag = seededRaw.replace(
      /tags:\n(?:\s*-\s.*\n)*/m,
      "tags:\n  - index\n",
    );
    await writeItemRawMarkdown(ctx, path, meta.id, itemId, rawWithLowercaseTag);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => "unused",
    );

    await crud.updateItem(itemId, { title: "After" });

    const afterRaw = await readItemRawMarkdown(fs, path, itemId);
    expect(afterRaw).toContain("title: After");
    expect(afterRaw).toContain("  - index");
    expect(afterRaw).not.toContain("  - Index");
  });

  it("preserves file FM tag spelling over catalog stored form on metadata-only update (#949)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-metadata-tag-spell-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const tagId = crypto.randomUUID();

    await writeTagsFile(fs, path, {
      tags: [
        {
          id: tagId,
          name: "web-dev",
          color: null,
          created_at: new Date().toISOString(),
        },
      ],
    });

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
        tag_ids: [tagId],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "body",
    });

    const seededRaw = await readItemRawMarkdown(fs, path, itemId);
    const rawWithUnderscoreTag = seededRaw.replace(
      /tags:\n(?:\s*-\s.*\n)*/m,
      "tags:\n  - web_dev\n",
    );
    await writeItemRawMarkdown(ctx, path, meta.id, itemId, rawWithUnderscoreTag);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => "unused",
    );

    await crud.updateItem(itemId, { title: "After" });

    const afterRaw = await readItemRawMarkdown(fs, path, itemId);
    expect(afterRaw).toContain("title: After");
    expect(afterRaw).toContain("  - web_dev");
    expect(afterRaw).not.toContain("  - web-dev");
  });
});
