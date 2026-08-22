import { describe, expect, it } from "vitest";
import { extractExternalMdLinks } from "./extract-external-md-links.js";

describe("extractExternalMdLinks (#457)", () => {
  it("collects http and mailto markdown links", () => {
    const body = "[web](https://example.com) [mail](mailto:a@b.c) [[Keep]]\n";
    const links = extractExternalMdLinks(body);
    expect(links.map((link) => link.rawTarget)).toEqual([
      "https://example.com",
      "mailto:a@b.c",
    ]);
    expect(links[0]!.displayText).toBe("web");
    expect(links[1]!.displayText).toBe("mail");
  });

  it("skips vault md links and wikilinks", () => {
    const body = "See [[Note]] and [doc](Folder/doc.md) plus [web](https://x.test).\n";
    const links = extractExternalMdLinks(body);
    expect(links).toEqual([
      expect.objectContaining({
        kind: "md",
        rawTarget: "https://x.test",
        displayText: "web",
      }),
    ]);
  });

  it("skips markdown images", () => {
    const body = "![alt](https://example.com/img.png) [web](https://example.com)\n";
    const links = extractExternalMdLinks(body);
    expect(links).toEqual([
      expect.objectContaining({
        kind: "md",
        rawTarget: "https://example.com",
        displayText: "web",
      }),
    ]);
  });
});
