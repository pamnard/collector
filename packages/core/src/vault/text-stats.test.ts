import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "../index/sql-index-test-harness.js";
import { createId } from "../util/ids.js";
import { parseDocumentMarkdown } from "./frontmatter.js";
import { upsertItem } from "./item-operations.js";
import { itemMarkdownPath } from "./paths.js";
import { countTextStats } from "./text-stats.js";

describe("countTextStats via upsert + index/disk", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("persists word/character counts from body through disk and BetterSqlite", async () => {
    const { ctx, fs, vault } = await suite.openVaultIndex("collector-text-stats-");
    const { meta, path } = vault;
    const timestamp = new Date().toISOString();

    const cases: Array<{ body: string; wordCount: number; characterCount: number }> = [
      { body: "", wordCount: 0, characterCount: 0 },
      { body: "ab cd", wordCount: 2, characterCount: 5 },
      { body: "привет мир", wordCount: 2, characterCount: 10 },
      { body: "hi 👋", wordCount: 1, characterCount: 4 },
      {
        body: "title: not frontmatter\n\nhello world",
        wordCount: 5,
        characterCount: Array.from("title: not frontmatter\n\nhello world").length,
      },
    ];

    for (const expected of cases) {
      const itemId = `${createId()}.md`;
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, itemId, {
          title: "Stats",
          created_at: timestamp,
          updated_at: timestamp,
        }),
        content: expected.body,
      });

      const docPath = itemMarkdownPath(path, itemId);
      expect(await fs.exists(docPath)).toBe(true);
      const { body: diskBody } = parseDocumentMarkdown(await readFile(docPath, "utf8"));
      expect(diskBody).toBe(expected.body);
      expect(countTextStats(diskBody)).toEqual({
        wordCount: expected.wordCount,
        characterCount: expected.characterCount,
      });

      const [row] = await ctx.index.listItemFilesByIds(meta.id, [itemId]);
      expect(row?.word_count).toBe(expected.wordCount);
      expect(row?.character_count).toBe(expected.characterCount);
    }
  });
});
