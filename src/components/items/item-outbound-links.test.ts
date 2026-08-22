import { describe, expect, it } from "vitest";
import type { OutboundTextLink } from "@collector/api";
import {
  outboundLinkLabel,
  externalOutboundUrlHint,
  splitOutboundLinks,
} from "./item-outbound-links";

describe("splitOutboundLinks (#457)", () => {
  it("splits internal and external while preserving order within each block", () => {
    const links: OutboundTextLink[] = [
      {
        scope: "internal",
        kind: "wikilink",
        rawTarget: "A",
        displayText: null,
        position: 0,
        resolvedItemId: "Inbox/a.md",
        status: "resolved",
        title: "A",
      },
      {
        scope: "external",
        kind: "md",
        rawTarget: "https://example.com",
        displayText: "web",
        position: 10,
        resolvedItemId: null,
        status: null,
        title: null,
      },
    ];
    expect(splitOutboundLinks(links)).toEqual({
      internal: [links[0]],
      external: [links[1]],
    });
  });
});

describe("outboundLinkLabel (#457)", () => {
  it("prefers resolved target title for internal links", () => {
    expect(
      outboundLinkLabel({
        scope: "internal",
        kind: "wikilink",
        rawTarget: "Alias",
        displayText: "Alias",
        position: 0,
        resolvedItemId: "Inbox/a.md",
        status: "resolved",
        title: "Target title",
      }),
    ).toBe("Target title");
  });

  it("falls back to raw target for broken internal links", () => {
    expect(
      outboundLinkLabel({
        scope: "internal",
        kind: "wikilink",
        rawTarget: "Missing",
        displayText: null,
        position: 0,
        resolvedItemId: null,
        status: "unresolved",
        title: null,
      }),
    ).toBe("Missing");
  });
});

describe("externalOutboundUrlHint (#457)", () => {
  it("returns URL when markdown label differs from href", () => {
    expect(
      externalOutboundUrlHint({
        scope: "external",
        kind: "md",
        rawTarget: "https://example.com/path",
        displayText: "статья",
        position: 0,
        resolvedItemId: null,
        status: null,
        title: null,
      }),
    ).toBe("https://example.com/path");
  });

  it("returns null when label equals URL or is absent", () => {
    expect(
      externalOutboundUrlHint({
        scope: "external",
        kind: "md",
        rawTarget: "https://example.com",
        displayText: "https://example.com",
        position: 0,
        resolvedItemId: null,
        status: null,
        title: null,
      }),
    ).toBeNull();
    expect(
      externalOutboundUrlHint({
        scope: "external",
        kind: "md",
        rawTarget: "https://example.com",
        displayText: null,
        position: 0,
        resolvedItemId: null,
        status: null,
        title: null,
      }),
    ).toBeNull();
  });
});
