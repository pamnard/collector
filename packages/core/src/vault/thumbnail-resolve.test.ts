import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import {
  applyItemCover,
  resolveItemThumbnailAbsolutePath,
} from "./cover-operations.js";
import { attachMediaFile } from "./media-operations.js";
import { createVault, upsertItem } from "./operations.js";
import { itemCoverPath } from "./paths.js";
import { resolveItemThumbnailPathsBatch } from "./thumbnail-resolve.js";

describe("resolveItemThumbnailPathsBatch", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedItem(title: string) {
    dataDir = await mkdtemp(join(tmpdir(), "collector-thumb-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title,
        description: "",
        content_type: "image",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    return { ctx, path, vaultId: meta.id, itemId };
  }

  it("returns cover path when thumbnail file exists", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Covered");
    const coverBytes = new TextEncoder().encode("fake-webp");
    const updated = await applyItemCover(ctx, path, vaultId, itemId, coverBytes);

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: updated.thumbnail ?? null },
    ]);

    expect(rows).toEqual([
      {
        id: itemId,
        path: itemCoverPath(path, itemId),
      },
    ]);
    expect(rows[0]!.path).toBe(
      resolveItemThumbnailAbsolutePath(path, itemId, updated.thumbnail),
    );
  });

  it("falls back to first image media when cover missing", async () => {
    const { ctx, path, itemId } = await seedItem("No cover");
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const media = await attachMediaFile(ctx, path, itemId, {
      filename: "shot.png",
      data: pngBytes,
    });

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: null },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(itemId);
    expect(rows[0]!.path).toContain(`${media.id}-shot.png`);
    expect(await fs.exists(rows[0]!.path!)).toBe(true);
  });

  it("returns null when no cover and no image media", async () => {
    const { path, itemId } = await seedItem("Empty");

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: null },
    ]);

    expect(rows).toEqual([{ id: itemId, path: null }]);
  });
});
