import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import {
  buildTextLinkResolveContext,
  textLinkResolveContextFromItems,
} from "./text-links-reindex.js";
import { parseAndResolveTextLinks } from "./parse-text-links.js";

async function seedTwoNotes(db: BetterSqliteMigrator) {
  await runMigrations(db);
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
     VALUES (?, ?, ?, '', 1, ?, ?)`,
    ["vault-1", "/tmp/v", "V", now, now],
  );
  for (const row of [
    { id: "Inbox/source.md", title: "Source" },
    { id: "Inbox/target.md", title: "Target" },
  ]) {
    await db.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision, word_count, character_count
      ) VALUES (?, ?, ?, '', 'note', 'manual', '{}', '{}', 1, 'Inbox', ?, ?, 1, 0, 0)`,
      [row.id, "vault-1", row.title, now, now],
    );
  }
}

describe("textLinkResolveContextFromItems", () => {
  it("indexes titles for unique resolve", () => {
    const context = textLinkResolveContextFromItems("Inbox/source.md", [
      { id: "Inbox/source.md", title: "Source" },
      { id: "Inbox/target.md", title: "Target" },
    ]);
    expect(context.idsByTitle("Target")).toEqual(["Inbox/target.md"]);
    expect(context.idExists("Inbox/target.md")).toBe(true);
  });
});

describe("buildTextLinkResolveContext", () => {
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

  it("loads id/title catalog and resolves wikilinks", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-text-links-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await seedTwoNotes(db);
    const context = await buildTextLinkResolveContext(db, "Inbox/source.md");
    expect(context).not.toBeNull();
    const links = parseAndResolveTextLinks("See [[Target]]\n", context!);
    expect(links[0]).toEqual(
      expect.objectContaining({
        kind: "wikilink",
        rawTarget: "Target",
        resolvedItemId: "Inbox/target.md",
      }),
    );
  });
});
