import { describe, expect, it } from "vitest";
import {
  buildEmbedText,
  extractPlainSnippet,
} from "./build-embed-text.js";
import { EMBED_MIN_PLAIN_CHARS } from "./constants.js";

describe("extractPlainSnippet", () => {
  it("strips links, tables, and code fences then takes a prefix", () => {
    const body = [
      "Intro paragraph with enough plain words for the minimum threshold here.",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "See [docs](https://example.com/path) and https://raw.example/x.",
      "",
      "```",
      "code noise",
      "```",
      "",
      "Closing sentence stays.",
    ].join("\n");

    const snippet = extractPlainSnippet(body);
    expect(snippet).not.toBeNull();
    expect(snippet!).not.toMatch(/https?:\/\//);
    expect(snippet!).not.toContain("|");
    expect(snippet!).not.toContain("code noise");
    expect(snippet!).toContain("docs");
    expect(snippet!).toContain("Intro paragraph");
  });

  it("returns null when cleaned text is too short", () => {
    expect(extractPlainSnippet("https://only.link")).toBeNull();
    expect(
      extractPlainSnippet("short"),
    ).toBeNull();
  });
});

describe("buildEmbedText", () => {
  it("uses title_desc_tags when all three are present", () => {
    const result = buildEmbedText({
      title: "Note",
      description: "About cats",
      tagNames: ["animals", "pets"],
    });
    expect(result).toEqual({
      mode: "title_desc_tags",
      text: "Note\nAbout cats\nanimals, pets",
    });
  });

  it("falls back to title_desc without tags", () => {
    const result = buildEmbedText({
      title: "Note",
      description: "About cats",
      tagNames: [],
    });
    expect(result).toEqual({
      mode: "title_desc",
      text: "Note\nAbout cats",
    });
  });

  it("uses body snippet when description is missing", () => {
    const body =
      "A reasonably long plain body that should become a snippet for embedding input. ".repeat(
        2,
      );
    const result = buildEmbedText({
      title: "Note",
      description: "",
      tagNames: ["x"],
      body,
    });
    expect(result?.mode).toBe("title_tags_snippet");
    expect(result?.text.startsWith("Note\nx\n")).toBe(true);
    expect(result!.text.length).toBeGreaterThan(EMBED_MIN_PLAIN_CHARS);
  });

  it("uses title_only for media-like items with just a title", () => {
    const result = buildEmbedText({
      title: "Vacation photo",
      description: "",
      tagNames: [],
      body: "",
    });
    expect(result).toEqual({
      mode: "title_only",
      text: "Vacation photo",
    });
  });

  it("returns null when there is no usable signal", () => {
    expect(
      buildEmbedText({
        title: "",
        description: "",
        tagNames: [],
        body: "|||",
      }),
    ).toBeNull();
  });
});
