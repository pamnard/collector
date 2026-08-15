import { describe, expect, it, vi } from "vitest";
import {
  buildBacklinkReverseMap,
  collectBacklinkSources,
} from "./collect-backlink-sources.js";
import * as textLinksReindex from "./text-links-reindex.js";

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

describe("catalog index reuse (#708)", () => {
  const catalog = [
    { id: "Inbox/target.md", title: "Target" },
    { id: "Notes/a.md", title: "Note A" },
    { id: "Notes/b.md", title: "Note B" },
    { id: "Notes/c.md", title: "Note C" },
  ];

  const bodies = [
    { id: "Notes/a.md", title: "Note A", body: "[[Target]]\n" },
    { id: "Notes/b.md", title: "Note B", body: "[[Target]]\n" },
    { id: "Notes/c.md", title: "Note C", body: "no links\n" },
  ];

  it("builds catalog id/title indexes once for collectBacklinkSources", () => {
    const spy = vi.spyOn(textLinksReindex, "textLinkCatalogIndexesFromItems");
    collectBacklinkSources("Inbox/target.md", catalog, bodies);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(catalog);
    spy.mockRestore();
  });

  it("builds catalog id/title indexes once for buildBacklinkReverseMap", () => {
    const spy = vi.spyOn(textLinksReindex, "textLinkCatalogIndexesFromItems");
    const reverse = buildBacklinkReverseMap(catalog, bodies);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(catalog);
    expect(reverse.get("Inbox/target.md")).toEqual([
      { id: "Notes/a.md", title: "Note A" },
      { id: "Notes/b.md", title: "Note B" },
    ]);
    spy.mockRestore();
  });
});
