import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID } from "./constants.js";
import { planEmbeddingReconcileTick } from "./embedding-reconcile.js";
import { putItemEmbedding } from "./embedding-store.js";

describe("planEmbeddingReconcileTick (#742)", () => {
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
    dataDir = await mkdtemp(join(tmpdir(), "collector-emb-reconcile-"));
    db = BetterSqliteMigrator.open(join(dataDir, "index.db"));
    await runMigrations(db);
    await db.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
    return db;
  }

  async function insertItem(options: {
    id: string;
    title: string;
    description?: string;
    contentRevision?: number;
    body?: string;
    tagNames?: string[];
  }): Promise<void> {
    const description = options.description ?? "";
    await db!.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision, word_count, character_count
      ) VALUES (?, 'v1', ?, ?, 'note', 'manual', '{}', '{}', ?, '', 't', 't', ?, 0, 0)`,
      [
        options.id,
        options.title,
        description,
        options.body ? 1 : 0,
        options.contentRevision ?? 1,
      ],
    );
    await db!.execute(
      `INSERT INTO items_fts (item_id, title, description, content)
       VALUES (?, ?, ?, ?)`,
      [options.id, options.title, description, options.body ?? ""],
    );
    for (const name of options.tagNames ?? []) {
      const tagId = `tag-${name}`;
      await db!.execute(
        `INSERT OR IGNORE INTO tags (id, vault_id, name, created_at)
         VALUES (?, 'v1', ?, 't')`,
        [tagId, name],
      );
      await db!.execute(
        `INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)`,
        [options.id, tagId],
      );
    }
  }

  async function putVector(
    itemId: string,
    modelId: string,
    contentRevision = 1,
  ): Promise<void> {
    await putItemEmbedding(db!, {
      itemId,
      modelId,
      contentRevision,
      inputFingerprint: "fp",
      vector: new Float32Array(EMBEDDING_DIMS),
      updatedAt: "t",
    });
  }

  it("enqueues when vector is missing and embed signal exists", async () => {
    const sql = await openDb();
    await insertItem({
      id: "a.md",
      title: "Garden roses",
      description: "notes about plants",
      tagNames: ["plants"],
    });

    const result = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 50,
      scanLimit: 200,
    });

    expect(result.inputs).toEqual([
      {
        itemId: "a.md",
        title: "Garden roses",
        description: "notes about plants",
        tagNames: ["plants"],
        contentRevision: 1,
      },
    ]);
    expect(result.stats).toEqual({
      scanned: 1,
      skippedNoSignal: 0,
      deferred: 0,
      batchFull: false,
    });
    expect(result.nextAfterItemId).toBe("a.md");
  });

  it("skips when vector is present for the current model", async () => {
    const sql = await openDb();
    await insertItem({
      id: "a.md",
      title: "Garden roses",
      description: "notes about plants",
    });
    await putVector("a.md", EMBEDDING_MODEL_ID);

    const result = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 50,
      scanLimit: 200,
    });

    expect(result.inputs).toEqual([]);
    expect(result.stats).toEqual({
      scanned: 0,
      skippedNoSignal: 0,
      deferred: 0,
      batchFull: false,
    });
    expect(result.nextAfterItemId).toBeNull();
  });

  it("enqueues when stored model_id differs from current engine", async () => {
    const sql = await openDb();
    await insertItem({
      id: "a.md",
      title: "Garden roses",
      description: "notes about plants",
    });
    await putVector("a.md", "stale-model");

    const result = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 50,
      scanLimit: 200,
    });

    expect(result.inputs.map((input) => input.itemId)).toEqual(["a.md"]);
    expect(result.stats.scanned).toBe(1);
    expect(result.stats.skippedNoSignal).toBe(0);
    expect(result.nextAfterItemId).toBe("a.md");
  });

  it("excludes no-signal items from the SQL scan window", async () => {
    const sql = await openDb();
    await insertItem({
      id: "empty.md",
      title: "",
      description: "",
    });

    const result = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 50,
      scanLimit: 200,
    });

    expect(result.inputs).toEqual([]);
    expect(result.stats).toEqual({
      scanned: 0,
      skippedNoSignal: 0,
      deferred: 0,
      batchFull: false,
    });
    expect(result.nextAfterItemId).toBeNull();
  });

  it("does not let no-signal head fill scanLimit and starve later signal items", async () => {
    const sql = await openDb();
    // Lexicographically first ids: empty titles fill an ASC window if unfiltered.
    await insertItem({ id: "a-empty.md", title: "" });
    await insertItem({ id: "b-empty.md", title: "" });
    await insertItem({ id: "c-empty.md", title: "" });
    await insertItem({
      id: "z-signal.md",
      title: "Late signal item",
      description: "should still enqueue",
    });

    const result = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 1,
      scanLimit: 2,
    });

    expect(result.inputs.map((input) => input.itemId)).toEqual(["z-signal.md"]);
    expect(result.stats).toEqual({
      scanned: 1,
      skippedNoSignal: 0,
      deferred: 0,
      batchFull: false,
    });
    expect(result.nextAfterItemId).toBe("z-signal.md");
  });

  it("defers signal items beyond batchSize and advances keyset past enqueued ids", async () => {
    const sql = await openDb();
    await insertItem({
      id: "a.md",
      title: "First",
      description: "one",
    });
    await insertItem({
      id: "b.md",
      title: "Second",
      description: "two",
    });
    await insertItem({
      id: "c.md",
      title: "Third",
      description: "three",
    });

    const first = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 1,
      scanLimit: 10,
    });
    expect(first.inputs.map((input) => input.itemId)).toEqual(["a.md"]);
    expect(first.stats).toEqual({
      scanned: 3,
      skippedNoSignal: 0,
      deferred: 2,
      batchFull: true,
    });
    expect(first.nextAfterItemId).toBe("a.md");

    const second = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 1,
      scanLimit: 10,
      afterItemId: first.nextAfterItemId!,
    });
    expect(second.inputs.map((input) => input.itemId)).toEqual(["b.md"]);
    expect(second.stats.deferred).toBe(1);
    expect(second.stats.batchFull).toBe(true);
    expect(second.nextAfterItemId).toBe("b.md");

    const third = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 1,
      scanLimit: 10,
      afterItemId: second.nextAfterItemId!,
    });
    expect(third.inputs.map((input) => input.itemId)).toEqual(["c.md"]);
    expect(third.stats.batchFull).toBe(false);
    expect(third.nextAfterItemId).toBe("c.md");

    const pastEnd = await planEmbeddingReconcileTick(sql, {
      vaultId: "v1",
      modelId: EMBEDDING_MODEL_ID,
      batchSize: 1,
      scanLimit: 10,
      afterItemId: third.nextAfterItemId!,
    });
    expect(pastEnd.inputs).toEqual([]);
    expect(pastEnd.nextAfterItemId).toBeNull();
  });

  it("rejects empty afterItemId", async () => {
    const sql = await openDb();
    await expect(
      planEmbeddingReconcileTick(sql, {
        vaultId: "v1",
        modelId: EMBEDDING_MODEL_ID,
        batchSize: 1,
        scanLimit: 10,
        afterItemId: "  ",
      }),
    ).rejects.toThrow(/afterItemId/);
  });
});
