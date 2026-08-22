import { describe, expect, it } from "vitest";
import { textEdgeRowsFromBody } from "./text-edge-rows.js";

describe("textEdgeRowsFromBody (#407)", () => {
  const catalog = [
    { id: "Inbox/target.md", title: "Target" },
    { id: "Notes/a.md", title: "Note A" },
  ];

  it("stores resolved and unresolved internal links", () => {
    const rows = textEdgeRowsFromBody(
      "vault-1",
      "Notes/a.md",
      "See [[Target]] and [[Missing]]\n",
      catalog,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        fromId: "Notes/a.md",
        toId: "Inbox/target.md",
        rawTarget: "Target",
        source: "text",
        kind: "wikilink",
        resolveStatus: "resolved",
      }),
      expect.objectContaining({
        fromId: "Notes/a.md",
        toId: null,
        rawTarget: "Missing",
        resolveStatus: "unresolved",
      }),
    ]);
  });

  it("dedupes multiple links to the same resolved target", () => {
    const rows = textEdgeRowsFromBody(
      "vault-1",
      "Notes/a.md",
      "[[Target]] and [[Target]]\n",
      catalog,
    );
    expect(rows).toHaveLength(1);
  });

  it("skips self links", () => {
    const rows = textEdgeRowsFromBody(
      "vault-1",
      "Notes/a.md",
      "[[Note A]]\n",
      catalog,
    );
    expect(rows).toEqual([]);
  });
});
