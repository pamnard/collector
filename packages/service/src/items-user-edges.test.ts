import { describe, expect, it, vi } from "vitest";
import { createItemsCrud } from "./items-crud.js";
import type { ItemsSearchServiceDeps } from "./items-search.js";

function createDeps(
  indexOverrides: Partial<ItemsSearchServiceDeps["getIndex"] extends () => infer T ? T : never> = {},
): ItemsSearchServiceDeps {
  const index = {
    listItemIdTitles: vi.fn(async () => []),
    listItemFtsBodies: vi.fn(async () => []),
    vaultItemsContentGeneration: vi.fn(async () => 0),
    listItemFilesByIds: vi.fn(async () => []),
    getAdjacentItems: vi.fn(async () => ({ prev: null, next: null })),
    addUserEdge: vi.fn(async () => {}),
    removeUserEdge: vi.fn(async () => {}),
    listUserEdges: vi.fn(async () => []),
    ...indexOverrides,
  };
  return {
    resolveActiveVault: vi.fn(async () => ({
      vault: { id: "vault-1", path: "/vault", name: "Vault" },
      path: "/vault",
    })),
    getContext: vi.fn(() => ({
      fs: {} as never,
      index: index as never,
    })),
    getIndex: () => index as never,
    kickoffVaultIndexSync: vi.fn(),
    buildSearchFtsQuery: vi.fn(() => null),
    addVaultSyncListener: vi.fn(() => () => {}),
    findSimilarItems: vi.fn(async () => []),
    normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
    enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
  };
}

describe("user edges RPC (#407)", () => {
  it("addUserEdge delegates to index with vault id", async () => {
    const addUserEdge = vi.fn(async () => {});
    const crud = createItemsCrud(createDeps({ addUserEdge }), () => "id");
    await crud.addUserEdge("a.md", "b.md");
    expect(addUserEdge).toHaveBeenCalledWith("vault-1", "a.md", "b.md");
  });

  it("listUserEdges returns index neighbors", async () => {
    const listUserEdges = vi.fn(async () => [{ id: "b.md", title: "Beta" }]);
    const crud = createItemsCrud(createDeps({ listUserEdges }), () => "id");
    await expect(crud.listUserEdges("a.md")).resolves.toEqual([
      { id: "b.md", title: "Beta" },
    ]);
  });
});
