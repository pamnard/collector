import { afterEach, describe, expect, it, vi } from "vitest";
import { collectBacklinkSources } from "../links/collect-backlink-sources.js";
import * as textLinksReindex from "../links/text-links-reindex.js";
import { parseDocumentMarkdown } from "../vault/frontmatter.js";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "../index/sql-index-test-harness.js";
import { createId } from "../util/ids.js";
import { rebuildVaultTextEdges } from "./sql-item-edges.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rebuildVaultTextEdges catalog indexes (#920)", () => {
  it("builds catalog id/title indexes once for full-vault rebuild", async () => {
    const catalog = [
      { id: "Inbox/target.md", title: "Target" },
      { id: "Notes/a.md", title: "Note A" },
      { id: "Notes/b.md", title: "Note B" },
    ];
    const bodies = [
      { id: "Notes/a.md", content: "[[Target]]\n" },
      { id: "Notes/b.md", content: "[[Target]]\n" },
      { id: "Inbox/target.md", content: "# Target\n" },
    ];
    const selector = {
      select: vi.fn(async () => []),
      execute: vi.fn(async () => undefined),
    };
    const spy = vi.spyOn(textLinksReindex, "textLinkCatalogIndexesFromItems");
    await rebuildVaultTextEdges(
      selector,
      "vault-1",
      async () => catalog,
      async () => bodies,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(catalog);
  });
});

describe("item_edges SQL (#407)", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("rebuildVaultTextEdges matches collectBacklinkSources parity", async () => {
    const { index, vault } = await suite.openVaultIndex("collector-edges-parity-");
    const { meta } = vault;
    const timestamp = new Date().toISOString();

    const targetId = "Inbox/target.md";
    const sourceA = "Notes/a.md";
    const sourceB = "Notes/b.md";

    await index.upsertItemMetadata(
      {
        item: noteItemFields(meta.id, targetId, {
          title: "Target",
          created_at: timestamp,
          updated_at: timestamp,
        }),
        fileMtimeMs: 1,
      },
      meta.id,
    );
    await index.upsertItemContent({
      itemId: targetId,
      title: "Target",
      description: "",
      content: "# Target\n",
      hasContentFile: true,
      sourceRef: null,
    });

    for (const [itemId, title, body] of [
      [sourceA, "Note A", "See [[Target]]\n"] as const,
      [sourceB, "Note B", "Also [x](../Inbox/target.md)\n"] as const,
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
      await index.upsertItemContent({
        itemId,
        title,
        description: "",
        content: body,
        hasContentFile: true,
        sourceRef: null,
      });
    }

    await index.rebuildVaultTextEdges(meta.id);

    const catalog = await index.listItemIdTitles(meta.id);
    const bodies = await index.listItemFtsBodies(meta.id);
    const runtime = collectBacklinkSources(
      targetId,
      catalog,
      bodies.map((row) => ({
        id: row.id,
        title: row.title,
        body: parseDocumentMarkdown(row.content).body,
      })),
    );
    const indexed = await index.listTextBacklinkSources(targetId);
    expect(indexed).toEqual(runtime);
  });

  it("add/list/remove user edges with canonical storage", async () => {
    const { index, vault } = await suite.openVaultIndex("collector-user-edges-");
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

    await index.addUserEdge(meta.id, itemB, itemA);
    expect(await index.listUserEdges(meta.id, itemA)).toEqual([
      { id: itemB, title: "Beta" },
    ]);
    expect(await index.listUserEdges(meta.id, itemB)).toEqual([
      { id: itemA, title: "Alpha" },
    ]);

    await index.removeUserEdge(meta.id, itemA, itemB);
    expect(await index.listUserEdges(meta.id, itemA)).toEqual([]);
  });
});
