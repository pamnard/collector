import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { FakeEmbeddingEngine } from "./fake-engine.js";
import { getItemEmbedding } from "./embedding-store.js";
import {
  findSimilarItemIds,
  recomputeItemEmbedding,
} from "./item-embeddings.js";

describe("item embedding orchestration", () => {
  let dataDir = "";
  let db: BetterSqliteMigrator | null = null;
  const engine = new FakeEmbeddingEngine();

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openDb(): Promise<BetterSqliteMigrator> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-emb-orch-"));
    db = BetterSqliteMigrator.open(join(dataDir, "index.db"));
    await runMigrations(db);
    await db.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
    return db;
  }

  async function insertItem(id: string, title: string): Promise<void> {
    await db!.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision
      ) VALUES (?, 'v1', ?, 'shared topic about gardens', 'note', 'manual', '{}', '{}', 0, '', 't', 't', 1)`,
      [id, title],
    );
  }

  it("writes vectors and ranks similar items; clears when signal disappears", async () => {
    const sql = await openDb();
    await insertItem("a.md", "Garden roses");
    await insertItem("b.md", "Garden tulips");
    await insertItem("c.md", "Unrelated quantum physics");

    await recomputeItemEmbedding(sql, engine, {
      itemId: "a.md",
      title: "Garden roses",
      description: "shared topic about gardens",
      tagNames: ["plants"],
      contentRevision: 1,
    });
    await recomputeItemEmbedding(sql, engine, {
      itemId: "b.md",
      title: "Garden tulips",
      description: "shared topic about gardens",
      tagNames: ["plants"],
      contentRevision: 1,
    });
    await recomputeItemEmbedding(sql, engine, {
      itemId: "c.md",
      title: "Unrelated quantum physics",
      description: "particle accelerators",
      tagNames: ["science"],
      contentRevision: 1,
    });

    const hits = await findSimilarItemIds(sql, engine, "a.md", 2);
    expect(hits[0]!.id).toBe("b.md");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);

    // Empty signal → row removed; similar returns [].
    await sql.execute("UPDATE items SET title = '', description = ? WHERE id = ?", [
      "",
      "a.md",
    ]);
    const kept = await recomputeItemEmbedding(sql, engine, {
      itemId: "a.md",
      title: "",
      description: "",
      tagNames: [],
      body: "",
      contentRevision: 2,
    });
    expect(kept).toBe(false);
    expect(await getItemEmbedding(sql, "a.md")).toBeNull();
    expect(await findSimilarItemIds(sql, engine, "a.md", 2)).toEqual([]);
  });
});
