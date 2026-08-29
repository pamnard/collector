/**
 * BetterSqlite item-id ORDER BY seams (#339/#901). Assert list order from the
 * index — not resolveItemIdOrderByClause string identity.
 *
 * title/created_at/content_type defaults are covered in sql-index-queries.test.ts;
 * this suite pins COLLATE, updated_at, and count columns.
 */
import { describe, expect, it } from "vitest";
import { createId } from "../util/ids.js";
import { upsertItem } from "../vault/item-operations.js";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "./sql-index-test-harness.js";

describe("item-id-sort on BetterSqlite (#339/#901)", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("orders by COLLATE title, updated_at, and count columns", async () => {
    const { db, index, ctx, vault } = await suite.openVaultIndex(
      "collector-item-id-sort-",
    );
    const { meta, path } = vault;

    const early = "2020-01-01T00:00:00.000Z";
    const mid = "2021-06-01T00:00:00.000Z";
    const late = "2022-01-01T00:00:00.000Z";

    const bananaId = `${createId()}.md`;
    const appleId = `${createId()}.md`;
    const cherryId = `${createId()}.md`;

    for (const id of [bananaId, appleId, cherryId]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          title: "seed",
          created_at: mid,
          updated_at: mid,
        }),
        content: "seed",
      });
    }

    // Pin sort columns after write: upsertItem recomputes counts and bumps updated_at.
    await db.execute(
      `UPDATE items SET title = ?, word_count = ?, character_count = ?,
        created_at = ?, updated_at = ? WHERE id = ?`,
      ["banana", 30, 200, late, early, bananaId],
    );
    await db.execute(
      `UPDATE items SET title = ?, word_count = ?, character_count = ?,
        created_at = ?, updated_at = ? WHERE id = ?`,
      ["Apple", 10, 50, early, late, appleId],
    );
    await db.execute(
      `UPDATE items SET title = ?, word_count = ?, character_count = ?,
        created_at = ?, updated_at = ? WHERE id = ?`,
      ["Cherry", 20, 100, mid, mid, cherryId],
    );

    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "title", dir: "asc" },
      }),
    ).toEqual([appleId, bananaId, cherryId]);

    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "updated_at", dir: "desc" },
      }),
    ).toEqual([appleId, cherryId, bananaId]);

    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "word_count", dir: "desc" },
      }),
    ).toEqual([bananaId, cherryId, appleId]);

    expect(
      await index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "character_count", dir: "asc" },
      }),
    ).toEqual([appleId, cherryId, bananaId]);
  });

  it("rejects unknown sort keys and dirs through the index query path", async () => {
    const { index, vault } = await suite.openVaultIndex(
      "collector-item-id-sort-reject-",
    );
    const { meta } = vault;

    await expect(
      index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "folder_path", dir: "asc" },
      }),
    ).rejects.toThrow(/Unsupported item id sort key/);

    await expect(
      index.listItemIdsByNavFilter(meta.id, "all", {
        sort: { key: "title", dir: "sideways" as "asc" },
      }),
    ).rejects.toThrow(/Unsupported item id sort dir/);
  });
});
