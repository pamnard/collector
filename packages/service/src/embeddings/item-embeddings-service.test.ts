import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqlVaultIndexStore } from "@collector/core";
import { FakeEmbeddingEngine } from "@collector/core/node";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { createItemEmbeddingsService } from "./item-embeddings-service.js";

describe("createItemEmbeddingsService", () => {
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

  it("refreshes vectors and returns similar ids via FakeEmbeddingEngine", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-emb-svc-"));
    db = BetterSqliteMigrator.open(join(dataDir, "index.db"));
    await runMigrations(db);
    await db.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["v1", dataDir, "V", "t", "t"],
    );
    for (const [id, title] of [
      ["a.md", "Garden roses"],
      ["b.md", "Garden tulips"],
      ["c.md", "Quantum foam"],
    ] as const) {
      await db.execute(
        `INSERT INTO items (
          id, vault_id, title, description, content_type, source_type,
          metadata_json, properties_json, has_content_file, folder_path,
          created_at, updated_at, content_revision
        ) VALUES (?, 'v1', ?, 'plants and soil', 'note', 'manual', '{}', '{}', 0, '', 't', 't', 1)`,
        [id, title],
      );
    }

    const service = createItemEmbeddingsService({
      getDb: () => db!,
      engine: new FakeEmbeddingEngine(),
    });

    await service.refresh([
      {
        itemId: "a.md",
        title: "Garden roses",
        description: "plants and soil",
        tagNames: ["garden"],
        contentRevision: 1,
      },
      {
        itemId: "b.md",
        title: "Garden tulips",
        description: "plants and soil",
        tagNames: ["garden"],
        contentRevision: 1,
      },
      {
        itemId: "c.md",
        title: "Quantum foam",
        description: "particle physics",
        tagNames: ["science"],
        contentRevision: 1,
      },
    ]);

    const hits = await service.findSimilarItems("a.md", 2);
    expect(hits[0]?.id).toBe("b.md");
    expect(hits.length).toBe(2);

    // Index store still works alongside embeddings table.
    const index = new SqlVaultIndexStore(db);
    expect(await index.listVaultItemIds("v1")).toHaveLength(3);
  });
});
