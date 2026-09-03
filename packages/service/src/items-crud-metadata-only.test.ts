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
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import type { VaultMeta } from "@collector/shared";
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

  async function seedTaggedNote(args: {
    tmpPrefix: string;
    catalogTagName: string;
    fileTagName: string;
  }): Promise<{
    ctx: VaultContext;
    index: SqlVaultIndexStore;
    meta: VaultMeta;
    path: string;
    itemId: string;
  }> {
    dataDir = await mkdtemp(join(tmpdir(), args.tmpPrefix));
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
          name: args.catalogTagName,
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
    const rawWithFileTag = seededRaw.replace(
      /tags:\n(?:\s*-\s.*\n)*/m,
      `tags:\n  - ${args.fileTagName}\n`,
    );
    await writeItemRawMarkdown(ctx, path, meta.id, itemId, rawWithFileTag);

    return { ctx, index, meta, path, itemId };
  }

  function createCrud(args: {
    ctx: VaultContext;
    index: SqlVaultIndexStore;
    meta: VaultMeta;
    path: string;
    normalizeMarkdown?: (raw: string) => { text: string; changed: boolean };
  }) {
    return createItemsCrud(
      {
        resolveActiveVault: async () => ({ path: args.path, vault: args.meta }),
        getContext: () => args.ctx,
        getIndex: () => args.index,
        normalizeMarkdown:
          args.normalizeMarkdown ??
          ((raw: string) => ({ text: raw, changed: false })),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => "unused",
    );
  }

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

    const normalizeMarkdown = vi.fn((raw: string) => ({
      text: raw.replace(/  \n/g, "\n"),
      changed: true,
    }));

    const crud = createCrud({ ctx, index, meta, path, normalizeMarkdown });
    await crud.updateItem(itemId, { title: "After" });

    expect(normalizeMarkdown).not.toHaveBeenCalled();
    const afterRaw = await readItemRawMarkdown(fs, path, itemId);
    expect(afterRaw).toContain(dirtyBody);
    expect(afterRaw).toContain("title: After");
  });

  it("preserves raw frontmatter tag casing on metadata-only update (#949)", async () => {
    const seeded = await seedTaggedNote({
      tmpPrefix: "collector-metadata-tag-case-",
      catalogTagName: "Index",
      fileTagName: "index",
    });
    const crud = createCrud(seeded);

    await crud.updateItem(seeded.itemId, { title: "After" });

    const afterRaw = await readItemRawMarkdown(fs, seeded.path, seeded.itemId);
    expect(afterRaw).toContain("title: After");
    expect(afterRaw).toContain("  - index");
    expect(afterRaw).not.toContain("  - Index");
  });

  it("preserves file FM tag spelling over catalog stored form on metadata-only update (#949)", async () => {
    const seeded = await seedTaggedNote({
      tmpPrefix: "collector-metadata-tag-spell-",
      catalogTagName: "web-dev",
      fileTagName: "web_dev",
    });
    const crud = createCrud(seeded);

    await crud.updateItem(seeded.itemId, { title: "After" });

    const afterRaw = await readItemRawMarkdown(fs, seeded.path, seeded.itemId);
    expect(afterRaw).toContain("title: After");
    expect(afterRaw).toContain("  - web_dev");
    expect(afterRaw).not.toContain("  - web-dev");
  });
});
