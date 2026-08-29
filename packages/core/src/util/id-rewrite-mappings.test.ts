/**
 * Overlap detection via real rewrite outcomes on BetterSqlite (#662/#901).
 * Cases unique to this helper: disjoint success and duplicate-newId failure.
 * Chain/embedding overlap covered in sql-index-rewrite.test.ts and
 * embedding-store.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "../index/sql-index-test-harness.js";
import { upsertItem } from "../vault/item-operations.js";
import { createId } from "./ids.js";

describe("mappingsHaveOverlappingIds via rewrite seams (#662/#901)", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("disjoint folder rename rewrites both ids", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex(
      "collector-rewrite-disjoint-",
    );
    const { meta, path } = vault;
    const timestamp = new Date().toISOString();
    const oldA = `Old/${createId()}.md`;
    const oldB = `Old/${createId()}.md`;
    const newA = oldA.replace("Old/", "New/");
    const newB = oldB.replace("Old/", "New/");

    for (const id of [oldA, oldB]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          folder_path: "Old",
          created_at: timestamp,
          updated_at: timestamp,
        }),
        content: `body-${id}`,
      });
    }

    await index.rewriteItemIds([
      { oldId: oldA, newId: newA, folderPath: "New" },
      { oldId: oldB, newId: newB, folderPath: "New" },
    ]);

    expect((await index.listVaultItemIds(meta.id)).sort()).toEqual(
      [newA, newB].sort(),
    );
    expect(await index.listItemIdsByFolderPrefix(meta.id, "Old")).toEqual([]);
    expect(
      (await index.listItemIdsByFolderPrefix(meta.id, "New")).sort(),
    ).toEqual([newA, newB].sort());
  });

  it("duplicate newId is treated as overlap and fails on the second rewrite", async () => {
    const { index, ctx, vault } = await suite.openVaultIndex(
      "collector-rewrite-dup-new-",
    );
    const { meta, path } = vault;
    const timestamp = new Date().toISOString();
    const idA = `notes/${createId()}.md`;
    const idB = `notes/${createId()}.md`;
    const idTarget = `notes/${createId()}.md`;

    for (const id of [idA, idB]) {
      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, id, {
          folder_path: "notes",
          created_at: timestamp,
          updated_at: timestamp,
        }),
      });
    }

    await expect(
      index.rewriteItemIds([
        { oldId: idA, newId: idTarget, folderPath: "notes" },
        { oldId: idB, newId: idTarget, folderPath: "notes" },
      ]),
    ).rejects.toThrow();

    const remaining = await index.listVaultItemIds(meta.id);
    expect(remaining).toContain(idTarget);
    expect(remaining).toContain(idB);
    expect(remaining).not.toContain(idA);
    expect(remaining.filter((id) => id === idTarget)).toHaveLength(1);
  });
});
