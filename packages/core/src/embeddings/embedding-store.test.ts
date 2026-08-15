import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import {
  deleteItemEmbedding,
  getItemEmbedding,
  listItemEmbeddingsForModel,
  putItemEmbedding,
  rewriteItemEmbeddingId,
  rewriteItemEmbeddingIds,
} from "./embedding-store.js";
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from "./constants.js";

describe("item embedding store", () => {
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
    dataDir = await mkdtemp(join(tmpdir(), "collector-emb-store-"));
    db = BetterSqliteMigrator.open(join(dataDir, "index.db"));
    await runMigrations(db);
    return db;
  }

  it("puts, gets, lists, and deletes a vector row", async () => {
    const sql = await openDb();
    // Parent item row required by FK.
    await sql.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
    await sql.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision
      ) VALUES (?, ?, 'T', '', 'note', 'manual', '{}', '{}', 0, '', ?, ?, 1)`,
      ["note.md", "v1", "t", "t"],
    );

    const vector = new Float32Array(EMBEDDING_DIMS);
    vector[0] = 1;
    vector[1] = 0.5;

    await putItemEmbedding(sql, {
      itemId: "note.md",
      modelId: EMBEDDING_MODEL_ID,
      contentRevision: 1,
      inputFingerprint: "fp1",
      vector,
      updatedAt: "t",
    });

    const got = await getItemEmbedding(sql, "note.md");
    expect(got).not.toBeNull();
    expect(got!.modelId).toBe(EMBEDDING_MODEL_ID);
    expect(got!.dims).toBe(EMBEDDING_DIMS);
    expect(got!.vector[0]).toBeCloseTo(1);
    expect(got!.vector[1]).toBeCloseTo(0.5);
    expect(got!.inputFingerprint).toBe("fp1");

    const listed = await listItemEmbeddingsForModel(sql, EMBEDDING_MODEL_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.itemId).toBe("note.md");

    await deleteItemEmbedding(sql, "note.md");
    expect(await getItemEmbedding(sql, "note.md")).toBeNull();
  });

  it("cascades delete when the item row is removed", async () => {
    const sql = await openDb();
    await sql.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
    await sql.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision
      ) VALUES (?, ?, 'T', '', 'note', 'manual', '{}', '{}', 0, '', ?, ?, 1)`,
      ["gone.md", "v1", "t", "t"],
    );
    const vector = new Float32Array(EMBEDDING_DIMS);
    vector[0] = 1;
    await putItemEmbedding(sql, {
      itemId: "gone.md",
      modelId: EMBEDDING_MODEL_ID,
      contentRevision: 1,
      inputFingerprint: "fp",
      vector,
      updatedAt: "t",
    });

    await sql.execute("DELETE FROM items WHERE id = ?", ["gone.md"]);
    expect(await getItemEmbedding(sql, "gone.md")).toBeNull();
  });

  it("rewrites a single embedding id", async () => {
    const sql = await openDb();
    await sql.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
    for (const id of ["old.md", "new.md"]) {
      await sql.execute(
        `INSERT INTO items (
          id, vault_id, title, description, content_type, source_type,
          metadata_json, properties_json, has_content_file, folder_path,
          created_at, updated_at, content_revision
        ) VALUES (?, ?, 'T', '', 'note', 'manual', '{}', '{}', 0, '', ?, ?, 1)`,
        [id, "v1", "t", "t"],
      );
    }

    const vector = new Float32Array(EMBEDDING_DIMS);
    vector[0] = 0.5;
    await putItemEmbedding(sql, {
      itemId: "old.md",
      modelId: EMBEDDING_MODEL_ID,
      contentRevision: 2,
      inputFingerprint: "fp-old",
      vector,
      updatedAt: "t",
    });

    await rewriteItemEmbeddingId(sql, "old.md", "new.md");
    expect(await getItemEmbedding(sql, "old.md")).toBeNull();
    const got = await getItemEmbedding(sql, "new.md");
    expect(got).not.toBeNull();
    expect(got!.inputFingerprint).toBe("fp-old");
    expect(got!.contentRevision).toBe(2);
  });

  it("rejects overlapping old/new ids in batch rewrite", async () => {
    const sql = await openDb();
    await expect(
      rewriteItemEmbeddingIds(sql, [
        { oldId: "A", newId: "B" },
        { oldId: "B", newId: "C" },
      ]),
    ).rejects.toThrow(/overlapping old\/new ids/);
  });
});
