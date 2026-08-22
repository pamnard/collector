import { beforeEach, describe, expect, it, vi } from "vitest";

const readItemContent = vi.fn();

vi.mock("@collector/core", async () => {
  const actual = await vi.importActual<typeof import("@collector/core")>(
    "@collector/core",
  );
  return {
    ...actual,
    readItemContent: (...args: unknown[]) => readItemContent(...args),
  };
});

import { createItemsCrud } from "./items-crud.js";

describe("listItemOutboundLinks (#457)", () => {
  beforeEach(() => {
    readItemContent.mockReset();
    readItemContent.mockResolvedValue(
      "See [[Target]] and [web](https://example.com) and [[Missing]]\n",
    );
  });

  it("returns internal and external links from item body", async () => {
    const listItemIdTitles = vi.fn(async () => [
      { id: "Inbox/source.md", title: "Source" },
      { id: "Inbox/target.md", title: "Target" },
    ]);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "vault-1" },
        }),
        getContext: () => ({
          fs: {
            exists: async () => true,
          },
        }),
        getIndex: () => ({
          listItemIdTitles,
        }),
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
      } as never,
      () => "n",
    );

    const links = await crud.listItemOutboundLinks("Inbox/source.md");
    expect(readItemContent).toHaveBeenCalled();
    expect(links.map((link) => link.scope)).toEqual([
      "internal",
      "external",
      "internal",
    ]);
    expect(links[0]).toMatchObject({
      scope: "internal",
      status: "resolved",
      resolvedItemId: "Inbox/target.md",
      title: "Target",
    });
    expect(links[1]).toMatchObject({
      scope: "external",
      rawTarget: "https://example.com",
      status: null,
    });
    expect(links[2]).toMatchObject({
      scope: "internal",
      status: "unresolved",
      rawTarget: "Missing",
    });
  });

  it("throws when item markdown is missing", async () => {
    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({
          path: "/vault",
          vault: { id: "vault-1" },
        }),
        getContext: () => ({
          fs: {
            exists: async () => false,
          },
        }),
        getIndex: () => ({
          listItemIdTitles: async () => [],
        }),
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
      } as never,
      () => "n",
    );

    await expect(
      crud.listItemOutboundLinks("Inbox/missing.md"),
    ).rejects.toThrow("Item not found: Inbox/missing.md");
  });
});
