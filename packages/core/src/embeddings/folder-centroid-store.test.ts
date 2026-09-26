import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { putItemEmbedding } from "./embedding-store.js";
import {
  getFolderCentroid,
  rebuildAllFolderCentroids,
  rebuildFolderCentroid,
} from "./folder-centroid-store.js";
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from "./constants.js";

describe("folder centroid store", () => {
  let dataDir = "";
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openDb(): Promise<BetterSqliteMigrator> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-folder-cent-"));
    db = BetterSqliteMigrator.open(join(dataDir, "index.db"));
    await runMigrations(db);
    return db;
  }

  async function seedVault(sql: BetterSqliteMigrator): Promise<void> {
    await sql.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
  }

  async function seedItem(
    sql: BetterSqliteMigrator,
    id: string,
    folder: string,
  ): Promise<void> {
    await sql.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision, word_count, character_count
      ) VALUES (?, ?, 'T', '', 'note', 'manual', '{}', '{}', 0, ?, ?, ?, 1, 0, 0)`,
      [id, "v1", folder, "t", "t"],
    );
  }

  it("rebuilds mean centroid and clears when empty", async () => {
    const sql = await openDb();
    await seedVault(sql);
    await seedItem(sql, "Design/a.md", "Design");
    await seedItem(sql, "Design/b.md", "Design");

    const a = new Float32Array(EMBEDDING_DIMS);
    a[0] = 2;
    const b = new Float32Array(EMBEDDING_DIMS);
    b[0] = 4;
    await putItemEmbedding(sql, {
      itemId: "Design/a.md",
      modelId: EMBEDDING_MODEL_ID,
      contentRevision: 1,
      inputFingerprint: "a",
      vector: a,
      updatedAt: "t",
    });
    await putItemEmbedding(sql, {
      itemId: "Design/b.md",
      modelId: EMBEDDING_MODEL_ID,
      contentRevision: 1,
      inputFingerprint: "b",
      vector: b,
      updatedAt: "t",
    });

    await rebuildFolderCentroid(sql, "Design", EMBEDDING_MODEL_ID);
    const got = await getFolderCentroid(sql, "Design", EMBEDDING_MODEL_ID);
    expect(got).not.toBeNull();
    expect(got!.itemCount).toBe(2);
    expect(got!.centroid[0]).toBeCloseTo(3);

    await sql.execute(`DELETE FROM item_embeddings WHERE item_id = ?`, [
      "Design/a.md",
    ]);
    await sql.execute(`DELETE FROM item_embeddings WHERE item_id = ?`, [
      "Design/b.md",
    ]);
    await rebuildFolderCentroid(sql, "Design", EMBEDDING_MODEL_ID);
    expect(await getFolderCentroid(sql, "Design", EMBEDDING_MODEL_ID)).toBeNull();
  });

  it("rebuildAll covers every folder with vectors", async () => {
    const sql = await openDb();
    await seedVault(sql);
    await seedItem(sql, "A/x.md", "A");
    await seedItem(sql, "B/y.md", "B");
    const vector = new Float32Array(EMBEDDING_DIMS);
    vector[0] = 1;
    for (const id of ["A/x.md", "B/y.md"]) {
      await putItemEmbedding(sql, {
        itemId: id,
        modelId: EMBEDDING_MODEL_ID,
        contentRevision: 1,
        inputFingerprint: id,
        vector,
        updatedAt: "t",
      });
    }
    await rebuildAllFolderCentroids(sql, EMBEDDING_MODEL_ID);
    expect(await getFolderCentroid(sql, "A", EMBEDDING_MODEL_ID)).not.toBeNull();
    expect(await getFolderCentroid(sql, "B", EMBEDDING_MODEL_ID)).not.toBeNull();
  });
});
