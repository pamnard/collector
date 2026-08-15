import { describe, expect, it, vi } from "vitest";
import { createItemsCrud } from "./items-crud.js";

describe("resolveContentTextLinks (#409)", () => {
  it("resolves wikilink by title via index catalog", async () => {
    const listItemIdTitles = vi.fn(async () => [
      { id: "Inbox/source.md", title: "Source" },
      { id: "Inbox/target.md", title: "WikiTarget409" },
    ]);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "vault-1" },
        }),
        getContext: () => ({ fs: {}, index: {} }),
        getIndex: () => ({
          listItemIdTitles,
        }),
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
      } as never,
      () => "n",
    );

    const links = await crud.resolveContentTextLinks(
      "Inbox/source.md",
      "See [[WikiTarget409]] please.\n",
    );

    expect(links).toEqual([
      expect.objectContaining({
        kind: "wikilink",
        rawTarget: "WikiTarget409",
        resolvedItemId: "Inbox/target.md",
      }),
    ]);
    expect(listItemIdTitles).toHaveBeenCalledWith("vault-1");
  });
});
