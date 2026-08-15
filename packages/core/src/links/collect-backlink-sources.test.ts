import { describe, expect, it } from "vitest";
import { collectBacklinkSources } from "./collect-backlink-sources.js";

describe("collectBacklinkSources (#410)", () => {
  const catalog = [
    { id: "Inbox/target.md", title: "Target" },
    { id: "Notes/a.md", title: "Note A" },
    { id: "Notes/b.md", title: "Note B" },
    { id: "Notes/self.md", title: "Self" },
  ];

  it("returns unique sources that resolve a link to the target", () => {
    const sources = collectBacklinkSources("Inbox/target.md", catalog, [
      { id: "Notes/a.md", title: "Note A", body: "See [[Target]] once.\n" },
      {
        id: "Notes/b.md",
        title: "Note B",
        body: "Also [here](../Inbox/target.md).\n",
      },
      { id: "Notes/self.md", title: "Self", body: "No links here.\n" },
    ]);
    expect(sources).toEqual([
      { id: "Notes/a.md", title: "Note A" },
      { id: "Notes/b.md", title: "Note B" },
    ]);
  });

  it("dedupes one source with multiple links to the same target", () => {
    const sources = collectBacklinkSources("Inbox/target.md", catalog, [
      {
        id: "Notes/a.md",
        title: "Note A",
        body: "[[Target]] and again [[Target]] and [x](../Inbox/target.md).\n",
      },
    ]);
    expect(sources).toEqual([{ id: "Notes/a.md", title: "Note A" }]);
  });

  it("skips unresolved links", () => {
    const sources = collectBacklinkSources("Inbox/target.md", catalog, [
      { id: "Notes/a.md", title: "Note A", body: "[[Missing]]\n" },
    ]);
    expect(sources).toEqual([]);
  });

  it("skips self-links", () => {
    const sources = collectBacklinkSources("Notes/self.md", catalog, [
      { id: "Notes/self.md", title: "Self", body: "[[Self]]\n" },
    ]);
    expect(sources).toEqual([]);
  });
});
