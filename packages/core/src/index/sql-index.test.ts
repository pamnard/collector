import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault, upsertItem } from "../vault/operations.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";

describe("listItemIdsByNavFilter", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("returns ids for all, favorite, and archived filters", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-nav-filter-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const activeId = createId();
    const favoriteId = createId();
    const archivedId = createId();
    const timestamp = new Date().toISOString();

    for (const [id, flags] of [
      [activeId, { is_archived: false, is_favorite: false }],
      [favoriteId, { is_archived: false, is_favorite: true }],
      [archivedId, { is_archived: true, is_favorite: false }],
    ] as const) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title: id,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          is_archived: flags.is_archived,
          is_favorite: flags.is_favorite,
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }

    expect(await index.listItemIdsByNavFilter(meta.id, "all")).toEqual([
      activeId,
      favoriteId,
    ]);
    expect(await index.listItemIdsByNavFilter(meta.id, "favorite")).toEqual([
      favoriteId,
    ]);
    expect(await index.listItemIdsByNavFilter(meta.id, "archived")).toEqual([
      archivedId,
    ]);
  });
});
