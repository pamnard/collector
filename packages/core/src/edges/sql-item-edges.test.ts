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

describe("wanted link targets query (#595)", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  async function seedNote(
    index: Awaited<ReturnType<typeof suite.openVaultIndex>>["index"],
    vaultId: string,
    itemId: string,
    title: string,
    body: string,
    folderPath: string | null = null,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    await index.upsertItemMetadata(
      {
        item: noteItemFields(vaultId, itemId, {
          title,
          folder_path: folderPath,
          created_at: timestamp,
          updated_at: timestamp,
        }),
        fileMtimeMs: 1,
      },
      vaultId,
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

  it("returns empty when no unresolved edges", async () => {
    const { index, vault } = await suite.openVaultIndex("collector-wanted-empty-");
    await seedNote(
      index,
      vault.meta.id,
      "Inbox/ok.md",
      "Ok",
      "# Ok\n",
    );
    await index.rebuildVaultTextEdges(vault.meta.id);
    const result = await index.queryWantedLinkTargets(vault.meta.id, {
      limit: 50,
      offset: 0,
    });
    expect(result).toEqual({ total: 0, rows: [] });
  });

  it("groups unresolved by raw_target; ambiguous stays separate; paginates; lists sources", async () => {
    const { index, vault } = await suite.openVaultIndex("collector-wanted-group-");
    const vaultId = vault.meta.id;

    await seedNote(index, vaultId, "Inbox/alpha.md", "Alpha", "[[Missing]]\n", "Inbox");
    await seedNote(index, vaultId, "Notes/beta.md", "Beta", "Also [[Missing]]\n", "Notes");
    await seedNote(
      index,
      vaultId,
      "Notes/dup-a.md",
      "Dup A",
      "[[AmbiguousTitle]]\n",
      "Notes",
    );
    await seedNote(
      index,
      vaultId,
      "Other/dup-b.md",
      "AmbiguousTitle",
      "# AmbiguousTitle\n",
      "Other",
    );
    await seedNote(
      index,
      vaultId,
      "Other/dup-c.md",
      "AmbiguousTitle",
      "# AmbiguousTitle\n",
      "Other",
    );
    await seedNote(
      index,
      vaultId,
      "Shelf/gamma.md",
      "Gamma",
      "See [[AmbiguousTitle]]\n",
      "Shelf",
    );
    await seedNote(
      index,
      vaultId,
      "Shelf/only.md",
      "Only",
      "[[Lonely]]\n",
      "Shelf",
    );

    await index.rebuildVaultTextEdges(vaultId);

    const all = await index.queryWantedLinkTargets(
      vaultId,
      { limit: 50, offset: 0 },
      { key: "source_count", dir: "desc" },
    );
    expect(all.total).toBeGreaterThanOrEqual(2);

    const missing = all.rows.find(
      (row) => row.rawTarget === "Missing" && row.resolveStatus === "unresolved",
    );
    expect(missing).toMatchObject({
      rawTarget: "Missing",
      resolveStatus: "unresolved",
      sourceCount: 2,
    });

    const ambiguous = all.rows.find(
      (row) =>
        row.rawTarget === "AmbiguousTitle" &&
        row.resolveStatus === "ambiguous",
    );
    expect(ambiguous).toMatchObject({
      rawTarget: "AmbiguousTitle",
      resolveStatus: "ambiguous",
      sourceCount: 2,
    });

    const page1 = await index.queryWantedLinkTargets(vaultId, {
      limit: 1,
      offset: 0,
    });
    expect(page1.total).toBe(all.total);
    expect(page1.rows).toHaveLength(1);
    expect(page1.rows[0]!.sourceCount).toBeGreaterThanOrEqual(
      all.rows[1]?.sourceCount ?? 0,
    );

    const sources = await index.listWantedLinkTargetSources(
      vaultId,
      { rawTarget: "Missing", resolveStatus: "unresolved" },
      { limit: 100, offset: 0 },
    );
    expect(sources.total).toBe(2);
    expect(sources.rows.map((r) => r.itemId).sort()).toEqual([
      "Inbox/alpha.md",
      "Notes/beta.md",
    ]);
    expect(sources.rows.find((r) => r.itemId === "Inbox/alpha.md")).toMatchObject({
      title: "Alpha",
      folderPath: "Inbox",
    });
  });

  it("sorts by raw_target ascending when requested", async () => {
    const { index, vault } = await suite.openVaultIndex("collector-wanted-sort-");
    const vaultId = vault.meta.id;
    await seedNote(index, vaultId, "a.md", "A", "[[Zebra]]\n");
    await seedNote(index, vaultId, "b.md", "B", "[[Apple]]\n");
    await index.rebuildVaultTextEdges(vaultId);

    const byName = await index.queryWantedLinkTargets(
      vaultId,
      { limit: 10, offset: 0 },
      { key: "raw_target", dir: "asc" },
    );
    expect(byName.rows.map((r) => r.rawTarget)).toEqual(["Apple", "Zebra"]);
  });
});
