import { describe, expect, it } from "vitest";
import { collectOutboundLinks } from "./collect-outbound-links.js";

describe("collectOutboundLinks (#457)", () => {
  const catalog = [
    { id: "Inbox/source.md", title: "Source" },
    { id: "Inbox/target.md", title: "Target Note" },
    { id: "A/dup.md", title: "Dup" },
    { id: "B/dup.md", title: "Dup" },
  ];

  it("returns internal and external in body order", () => {
    const body =
      "[[Target Note]] then [web](https://example.com) then [[Missing]]\n";
    const links = collectOutboundLinks("Inbox/source.md", body, catalog);
    expect(links.map((link) => link.scope)).toEqual([
      "internal",
      "external",
      "internal",
    ]);
    expect(links[0]).toMatchObject({
      scope: "internal",
      rawTarget: "Target Note",
      status: "resolved",
      resolvedItemId: "Inbox/target.md",
      title: "Target Note",
    });
    expect(links[1]).toMatchObject({
      scope: "external",
      rawTarget: "https://example.com",
      status: null,
      displayText: "web",
    });
    expect(links[2]).toMatchObject({
      scope: "internal",
      rawTarget: "Missing",
      status: "unresolved",
      resolvedItemId: null,
      title: null,
    });
  });

  it("marks ambiguous title targets", () => {
    const body = "See [[Dup]]\n";
    const links = collectOutboundLinks("Inbox/source.md", body, catalog);
    expect(links).toEqual([
      expect.objectContaining({
        scope: "internal",
        rawTarget: "Dup",
        status: "ambiguous",
        resolvedItemId: null,
      }),
    ]);
  });

  it("dedupes repeated links to the same target", () => {
    const body = "[[Target Note]] and [[Target Note]] again\n";
    const links = collectOutboundLinks("Inbox/source.md", body, catalog);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      scope: "internal",
      rawTarget: "Target Note",
      status: "resolved",
      resolvedItemId: "Inbox/target.md",
      position: 0,
    });
  });

  it("dedupes repeated external links with the same label and URL", () => {
    const body =
      "[web](https://example.com) and again [web](https://example.com)\n";
    const links = collectOutboundLinks("Inbox/source.md", body, catalog);
    expect(links).toEqual([
      expect.objectContaining({
        scope: "external",
        rawTarget: "https://example.com",
        displayText: "web",
        position: 0,
      }),
    ]);
  });

  it("keeps external links that share a URL but use different labels", () => {
    const body =
      "[one](https://example.com) then [two](https://example.com)\n";
    const links = collectOutboundLinks("Inbox/source.md", body, catalog);
    expect(links.map((link) => link.displayText)).toEqual(["one", "two"]);
  });

  it("dedupes different raw targets that resolve to the same item", () => {
    const body = "[[Target Note]] and [note](../Inbox/target.md)\n";
    const links = collectOutboundLinks("Inbox/source.md", body, catalog);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      scope: "internal",
      resolvedItemId: "Inbox/target.md",
      position: 0,
    });
  });
});
