import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearBacklinkReverseCache } from "./backlinks-reverse-cache.js";
import { createItemsCrud } from "./items-crud.js";

describe("listItemBacklinks (#410)", () => {
  beforeEach(() => {
    clearBacklinkReverseCache();
  });
  it("returns unique sources that link to the target from FTS bodies", async () => {
    const listItemIdTitles = vi.fn(async () => [
      { id: "Inbox/target.md", title: "Target" },
      { id: "Notes/a.md", title: "Note A" },
      { id: "Notes/b.md", title: "Note B" },
    ]);
    const listItemFtsBodies = vi.fn(async () => [
      {
        id: "Notes/a.md",
        title: "Note A",
        content: "---\ntitle: Note A\n---\nSee [[Target]] and [[Target]] again.\n",
      },
      {
        id: "Notes/b.md",
        title: "Note B",
        content: "No links.\n",
      },
      {
        id: "Inbox/target.md",
        title: "Target",
        content: "[[Target]] self should be ignored.\n",
      },
    ]);
    const vaultItemsContentGeneration = vi.fn(async () => 3);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "vault-1" },
        }),
        getContext: () => ({ fs: {}, index: {} }),
        getIndex: () => ({
          listItemIdTitles,
          listItemFtsBodies,
          vaultItemsContentGeneration,
        }),
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
      } as never,
      () => "n",
    );

    const first = await crud.listItemBacklinks("Inbox/target.md");
    expect(first).toEqual([{ id: "Notes/a.md", title: "Note A" }]);

    const second = await crud.listItemBacklinks("Inbox/target.md");
    expect(second).toEqual([{ id: "Notes/a.md", title: "Note A" }]);
    // Second call reuses in-memory reverse map for the same generation.
    expect(listItemFtsBodies).toHaveBeenCalledTimes(1);
    expect(vaultItemsContentGeneration).toHaveBeenCalledTimes(2);
  });

  it("rebuilds reverse map when content generation changes", async () => {
    let generation = 1;
    const listItemIdTitles = vi.fn(async () => [
      { id: "Inbox/target.md", title: "Target" },
      { id: "Notes/a.md", title: "Note A" },
    ]);
    const listItemFtsBodies = vi.fn(async () => [
      {
        id: "Notes/a.md",
        title: "Note A",
        content: "See [[Target]].\n",
      },
    ]);
    const vaultItemsContentGeneration = vi.fn(async () => generation);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "vault-1" },
        }),
        getContext: () => ({ fs: {}, index: {} }),
        getIndex: () => ({
          listItemIdTitles,
          listItemFtsBodies,
          vaultItemsContentGeneration,
        }),
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
      } as never,
      () => "n",
    );

    await crud.listItemBacklinks("Inbox/target.md");
    generation = 2;
    await crud.listItemBacklinks("Inbox/target.md");
    expect(listItemFtsBodies).toHaveBeenCalledTimes(2);
  });
});
