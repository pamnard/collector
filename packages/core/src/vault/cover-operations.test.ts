import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "../vault/vault-operations.js";
import { upsertItem } from "../vault/item-operations.js";
import {
  applyItemCover,
  clearItemCover,
  touchItemUpdatedAt,
} from "./cover-operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { itemCoverPath, itemMarkdownPath } from "./paths.js";
import { readItemFile, writeItemFile } from "./item-io.js";

async function seedPhotoItem(
  ctx: { fs: NodeFileSystemAdapter; index: SqlVaultIndexStore },
  path: string,
  vaultId: string,
  updatedAt: string,
): Promise<string> {
  const itemId = `${createId()}.md`;
  await upsertItem(ctx, path, vaultId, {
    item: {
      id: itemId,
      vault_id: vaultId,
      title: "Photo",
      description: "",
      content_type: "image",
      source_type: "manual",
      metadata: {},
      properties: {},
      tag_ids: [],
      collection_ids: [],
      folder_path: "",
      content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: updatedAt,
      updated_at: updatedAt,
    },
  });
  // upsertItem stamps now(); pin a stable updated_at for bump assertions.
  const written = await readItemFile(ctx.fs, path, itemId, vaultId);
  await writeItemFile(ctx.fs, path, { ...written, updated_at: updatedAt });
  return itemId;
}

describe("cover operations", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("stores cover.webp on disk and does not write vault paths into frontmatter", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-cover-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = await seedPhotoItem(
      ctx,
      path,
      meta.id,
      "2026-01-01T00:00:00.000Z",
    );

    const withStaleFm = await readItemFile(fs, path, itemId, meta.id);
    await writeItemFile(fs, path, {
      ...withStaleFm,
      thumbnail: `${itemId.replace(/\.md$/, "")}.media/cover.webp`,
    });

    const coverBytes = new TextEncoder().encode("fake-webp");
    const updated = await applyItemCover(ctx, path, meta.id, itemId, coverBytes);

    expect(updated.thumbnail).toBeNull();
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(true);
    expect(await fs.readBinary(itemCoverPath(path, itemId))).toEqual(coverBytes);

    const cleared = await clearItemCover(ctx, path, meta.id, itemId);
    expect(cleared.thumbnail).toBeNull();
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(false);
    expect((await readItemFile(fs, path, itemId, meta.id)).thumbnail).toBeNull();
  });

  it("applyItemCover bumps updated_at when thumbnail is already null (#720)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-cover-bump-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const before = "2026-01-01T00:00:00.000Z";
    const itemId = await seedPhotoItem(ctx, path, meta.id, before);

    const beforeItem = await readItemFile(fs, path, itemId, meta.id);
    expect(beforeItem.thumbnail).toBeNull();
    expect(beforeItem.updated_at).toBe(before);

    const coverBytes = new TextEncoder().encode("fake-webp");
    const updated = await applyItemCover(ctx, path, meta.id, itemId, coverBytes);

    expect(updated.thumbnail).toBeNull();
    expect(updated.updated_at > before).toBe(true);
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(true);
    expect((await readItemFile(fs, path, itemId, meta.id)).updated_at).toBe(
      updated.updated_at,
    );
  });

  it("clearItemCover bumps updated_at when thumbnail is already null (#720)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-cover-clear-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const seeded = "2026-01-01T00:00:00.000Z";
    const itemId = await seedPhotoItem(ctx, path, meta.id, seeded);

    const afterApply = await applyItemCover(
      ctx,
      path,
      meta.id,
      itemId,
      new TextEncoder().encode("fake-webp"),
    );
    const beforeClear = afterApply.updated_at;

    const cleared = await clearItemCover(ctx, path, meta.id, itemId);
    expect(cleared.thumbnail).toBeNull();
    expect(cleared.updated_at > beforeClear).toBe(true);
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(false);
  });

  it("touchItemUpdatedAt bumps updated_at without changing thumbnail (#720)", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-touch-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const before = "2026-01-01T00:00:00.000Z";
    const itemId = await seedPhotoItem(ctx, path, meta.id, before);

    const touched = await touchItemUpdatedAt(ctx, path, meta.id, itemId);
    expect(touched.thumbnail).toBeNull();
    expect(touched.updated_at > before).toBe(true);
    expect((await readItemFile(fs, path, itemId, meta.id)).updated_at).toBe(
      touched.updated_at,
    );

    // #735: persistItemPresentation must write file_mtime_ms — not NULL.
    const docPath = itemMarkdownPath(path, itemId);
    const stat = await fs.stat(docPath);
    if (stat.mtimeMs === null) {
      throw new Error(`missing mtimeMs for ${itemId} on disk`);
    }
    const stamps = await ctx.index.listItemPresentationStampsByIds(meta.id, [itemId]);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]!).toBe(String(stat.mtimeMs));
  });
});
