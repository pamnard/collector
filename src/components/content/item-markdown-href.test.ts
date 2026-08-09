import { describe, expect, it } from "vitest";
import { COLLECTOR_UNRESOLVED_HREF_PREFIX } from "@collector/core";
import {
  classifyItemMarkdownHref,
  collectorMarkdownUrlTransform,
} from "./item-markdown-href";

describe("classifyItemMarkdownHref", () => {
  it("detects internal item paths", () => {
    expect(classifyItemMarkdownHref("/item/Inbox/a.md")).toBe("item");
  });

  it("detects unresolved marker", () => {
    expect(
      classifyItemMarkdownHref(
        `${COLLECTOR_UNRESOLVED_HREF_PREFIX}${encodeURIComponent("Missing")}`,
      ),
    ).toBe("unresolved");
  });

  it("treats http as external", () => {
    expect(classifyItemMarkdownHref("https://example.com")).toBe("external");
  });
});

describe("collectorMarkdownUrlTransform", () => {
  it("keeps collector-unresolved hrefs", () => {
    const href = `${COLLECTOR_UNRESOLVED_HREF_PREFIX}MissingNote`;
    expect(collectorMarkdownUrlTransform(href)).toBe(href);
  });

  it("keeps /item/ paths", () => {
    expect(collectorMarkdownUrlTransform("/item/Inbox/a.md")).toBe(
      "/item/Inbox/a.md",
    );
  });

  it("still allows https", () => {
    expect(collectorMarkdownUrlTransform("https://example.com/a")).toBe(
      "https://example.com/a",
    );
  });
});
