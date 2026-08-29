import { describe, expect, it } from "vitest";
import {
  createSqlIndexTestSuite,
  noteItemFields,
  type SqlIndexTestEnv,
} from "../../core/src/index/sql-index-test-harness.js";
import { createId } from "../../core/src/util/ids.js";
import { createItemsCrud } from "./items-crud.js";

const suite = createSqlIndexTestSuite();
suite.registerCleanup();

function createCrud(env: SqlIndexTestEnv): ReturnType<typeof createItemsCrud> {
  const { index, vault, ctx } = env;
  const { meta, path } = vault;
  return createItemsCrud(
    {
      resolveActiveVault: async () => ({ vault: meta, path }),
      getContext: () => ctx as never,
      getIndex: () => index as never,
      normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
      enqueueItemDerivedRefresh: async () => undefined,
      enqueueItemExtractAuto: async () => undefined,
    } as never,
    () => createId(),
  );
}

describe("user edges RPC (#407) against real SQL index", () => {
  it("add/list/remove user edges through service over BetterSqlite", async () => {
    const env = await suite.openVaultIndex(
      "collector-svc-user-edges-",
      "user-edges.db",
    );
    const { index, vault } = env;
    const { meta } = vault;
    const timestamp = new Date().toISOString();
    const itemA = `${createId()}.md`;
    const itemB = `${createId()}.md`;

    for (const [itemId, title] of [
      [itemA, "Alpha"] as const,
      [itemB, "Beta"] as const,
    ]) {
      await index.upsertItemMetadata(
        {
          item: noteItemFields(meta.id, itemId, {
            title,
            created_at: timestamp,
            updated_at: timestamp,
          }),
          fileMtimeMs: 1,
        },
        meta.id,
      );
    }

    const crud = createCrud(env);

    await crud.addUserEdge(itemA, itemB);

    expect(await crud.listUserEdges(itemA)).toEqual([
      { id: itemB, title: "Beta" },
    ]);
    expect(await crud.listUserEdges(itemB)).toEqual([
      { id: itemA, title: "Alpha" },
    ]);
    expect(await index.listUserEdges(meta.id, itemA)).toEqual([
      { id: itemB, title: "Beta" },
    ]);

    await crud.removeUserEdge(itemA, itemB);

    expect(await crud.listUserEdges(itemA)).toEqual([]);
    expect(await crud.listUserEdges(itemB)).toEqual([]);
    expect(await index.listUserEdges(meta.id, itemA)).toEqual([]);
  });
});
