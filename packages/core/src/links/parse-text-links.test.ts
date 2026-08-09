import { describe, expect, it } from "vitest";
import { parseAndResolveTextLinks } from "./parse-text-links.js";
import type { TextLinkResolveContext } from "./resolve-text-links.js";

function ctx(options: {
  sourceItemId: string;
  ids: string[];
  titles?: Record<string, string[]>;
}): TextLinkResolveContext {
  const idSet = new Set(options.ids);
  const titles = options.titles ?? {};
  return {
    sourceItemId: options.sourceItemId,
    idExists: (id) => idSet.has(id),
    idsByTitle: (title) => titles[title] ?? [],
  };
}

describe("parseAndResolveTextLinks", () => {
  it("extracts and resolves in one call", () => {
    const body = "See [[Target]] and [rel](../other.md).\n";
    const links = parseAndResolveTextLinks(
      body,
      ctx({
        sourceItemId: "Folder/sub/a.md",
        ids: ["Inbox/target.md", "Folder/other.md"],
        titles: { Target: ["Inbox/target.md"] },
      }),
    );
    expect(links).toEqual([
      expect.objectContaining({
        kind: "wikilink",
        rawTarget: "Target",
        resolvedItemId: "Inbox/target.md",
      }),
      expect.objectContaining({
        kind: "md",
        rawTarget: "../other.md",
        resolvedItemId: "Folder/other.md",
      }),
    ]);
  });

  it("uses body only (caller strips frontmatter)", () => {
    const body = "[[OnlyBody]]\n";
    const links = parseAndResolveTextLinks(
      body,
      ctx({
        sourceItemId: "a.md",
        ids: [],
        titles: { OnlyBody: ["b.md"] },
      }),
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.resolvedItemId).toBe("b.md");
  });
});
