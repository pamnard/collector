import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId } from "../util/ids.js";
import { createVault } from "./vault-operations.js";
import { listItemsByIds, upsertItem } from "./item-operations.js";
import { itemMarkdownPath } from "./paths.js";
import { countTextStats } from "./text-stats.js";
import { parseDocumentMarkdown } from "./frontmatter.js";

describe("countTextStats via upsert + index/disk", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-text-stats-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  async function writeNoteAndAssert(
    body: string,
    expected: { wordCount: number; characterCount: number },
  ) {
    const { ctx, meta, path } = await seedVault();
    const itemId = `${createId()}.md`;
    const timestamp = new Date().toISOString();

    expect(countTextStats(body)).toEqual(expected);

    const written = await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Stats",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: body,
    });

    expect(written.word_count).toBe(expected.wordCount);
    expect(written.character_count).toBe(expected.characterCount);

    const docPath = itemMarkdownPath(path, itemId);
    expect(await fs.exists(docPath)).toBe(true);
    const raw = await readFile(docPath, "utf8");
    const { body: diskBody } = parseDocumentMarkdown(raw);
    expect(countTextStats(diskBody)).toEqual(expected);

    const [indexed] = await listItemsByIds(ctx, path, [itemId]);
    expect(indexed?.word_count).toBe(expected.wordCount);
    expect(indexed?.character_count).toBe(expected.characterCount);

    const rows = await ctx.index.listItemFilesByIds(meta.id, [itemId]);
    expect(rows[0]?.word_count).toBe(expected.wordCount);
    expect(rows[0]?.character_count).toBe(expected.characterCount);
  }

  it("returns zeros for empty body", async () => {
    await writeNoteAndAssert("", { wordCount: 0, characterCount: 0 });
  });

  it("counts characters including spaces", async () => {
    await writeNoteAndAssert("ab cd", { wordCount: 2, characterCount: 5 });
  });

  it("counts unicode words and code points", async () => {
    await writeNoteAndAssert("привет мир", { wordCount: 2, characterCount: 10 });
  });

  it("counts emoji as code points, not as letter-words", async () => {
    await writeNoteAndAssert("hi 👋", { wordCount: 1, characterCount: 4 });
  });

  it("does not treat YAML-looking lines specially — caller passes body only", async () => {
    const body = "title: not frontmatter\n\nhello world";
    await writeNoteAndAssert(body, {
      wordCount: 5,
      characterCount: Array.from(body).length,
    });
  });
});
