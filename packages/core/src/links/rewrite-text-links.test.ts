import { describe, expect, it } from "vitest";
import { extractTextLinks } from "./extract-text-links.js";
import { resolveTextLinks } from "./resolve-text-links.js";
import {
  COLLECTOR_UNRESOLVED_HREF_PREFIX,
  decodeItemPathHref,
  itemPathHref,
  rewriteTextLinksForMarkdown,
} from "./rewrite-text-links.js";

describe("rewriteTextLinksForMarkdown", () => {
  it("rewrites resolved wikilink with alias", () => {
    const body = "See [[path/to.md|Alias]] here.\n";
    const links = resolveTextLinks(extractTextLinks(body), {
      sourceItemId: "Inbox/a.md",
      idExists: (id) => id === "path/to.md",
      idsByTitle: () => [],
    });
    expect(rewriteTextLinksForMarkdown(body, links)).toBe(
      "See [Alias](/item/path/to.md) here.\n",
    );
  });

  it("rewrites resolved wikilink without alias using target key", () => {
    const body = "Go [[Target]] now.\n";
    const links = resolveTextLinks(extractTextLinks(body), {
      sourceItemId: "Inbox/a.md",
      idExists: () => false,
      idsByTitle: (title) => (title === "Target" ? ["Inbox/t.md"] : []),
    });
    expect(rewriteTextLinksForMarkdown(body, links)).toBe(
      "Go [Target](/item/Inbox/t.md) now.\n",
    );
  });

  it("rewrites unresolved wikilink with collector-unresolved href", () => {
    const body = "[[Missing]]\n";
    const links = resolveTextLinks(extractTextLinks(body), {
      sourceItemId: "a.md",
      idExists: () => false,
      idsByTitle: () => [],
    });
    const out = rewriteTextLinksForMarkdown(body, links);
    expect(out).toBe(
      `[Missing](${COLLECTOR_UNRESOLVED_HREF_PREFIX}${encodeURIComponent("Missing")})\n`,
    );
  });

  it("rewrites relative md link to item path", () => {
    const body = "Go [label](../x.md) please.\n";
    const links = resolveTextLinks(extractTextLinks(body), {
      sourceItemId: "Folder/sub/a.md",
      idExists: (id) => id === "Folder/x.md",
      idsByTitle: () => [],
    });
    expect(rewriteTextLinksForMarkdown(body, links)).toBe(
      "Go [label](/item/Folder/x.md) please.\n",
    );
  });

  it("rewrites multiple links from the end without corrupting offsets", () => {
    const body = "[[A]] then [b](Folder/b.md)\n";
    const links = resolveTextLinks(extractTextLinks(body), {
      sourceItemId: "Inbox/a.md",
      idExists: (id) => id === "Inbox/a-note.md" || id === "Folder/b.md",
      idsByTitle: (title) => (title === "A" ? ["Inbox/a-note.md"] : []),
    });
    expect(rewriteTextLinksForMarkdown(body, links)).toBe(
      "[A](/item/Inbox/a-note.md) then [b](/item/Folder/b.md)\n",
    );
  });

  it("exposes itemPathHref helper", () => {
    expect(itemPathHref("Inbox/n.md")).toBe("/item/Inbox/n.md");
  });

  it("encodes spaces in item paths so markdown still parses the link", () => {
    const body = "See [[Target]]\n";
    const itemId =
      "AI/Agentic AI/Безопасность и governance/2ab8e763-160e-409e-b77d-2adb1310c9cf.md";
    const links = resolveTextLinks(extractTextLinks(body), {
      sourceItemId: "Inbox/a.md",
      idExists: () => false,
      idsByTitle: (title) => (title === "Target" ? [itemId] : []),
    });
    const out = rewriteTextLinksForMarkdown(body, links);
    expect(out).toBe(`See [Target](${itemPathHref(itemId)})\n`);
    expect(out).toContain("Agentic%20AI");
    expect(out).not.toContain("/item/AI/Agentic AI/");
    expect(decodeItemPathHref(itemPathHref(itemId))).toBe(`/item/${itemId}`);
  });
});
