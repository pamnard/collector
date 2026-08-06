import { describe, expect, it } from "vitest";
import {
  classifyDropFilename,
  titleStemFromFilename,
} from "./drop-import-classify.js";
import { resolveDropTitle } from "./resolve-drop-title.js";

describe("drop-import-classify", () => {
  it("classifies media and notes; skips unsupported", () => {
    expect(classifyDropFilename("a.png")).toEqual({
      kind: "media",
      contentType: "image",
      mediaType: "image",
    });
    expect(classifyDropFilename("clip.mp4")).toEqual({
      kind: "media",
      contentType: "video",
      mediaType: "video",
    });
    expect(classifyDropFilename("doc.pdf")).toEqual({
      kind: "media",
      contentType: "pdf",
      mediaType: "pdf",
    });
    expect(classifyDropFilename("track.mp3")).toEqual({
      kind: "media",
      contentType: "audio",
      mediaType: "audio",
    });
    expect(classifyDropFilename("note.md")).toEqual({ kind: "note" });
    expect(classifyDropFilename("Trip/nested/x.MD")).toEqual({ kind: "note" });
    expect(classifyDropFilename("virus.exe")).toEqual({ kind: "skip" });
    expect(classifyDropFilename("readme.txt")).toEqual({ kind: "skip" });
  });

  it("titleStemFromFilename strips extension", () => {
    expect(titleStemFromFilename("photo.png")).toBe("photo");
    expect(titleStemFromFilename("Trip/a.b.md")).toBe("a.b");
  });

  it("resolveDropTitle prefers frontmatter title for markdown", () => {
    const raw = "---\ntitle: From FM\n---\n\nBody\n";
    expect(resolveDropTitle("ignored.md", raw)).toBe("From FM");
  });

  it("resolveDropTitle keeps FM title when sibling fields are foreign/invalid", () => {
    const raw = `---
title: From FM
type: agentic-pattern
content_type: not-a-real-type
---
Body
`;
    expect(resolveDropTitle("ignored.md", raw)).toBe("From FM");
  });

  it("resolveDropTitle falls back to stem when no FM title", () => {
    expect(resolveDropTitle("my-note.md", "# Hello\n")).toBe("my-note");
    expect(resolveDropTitle("shot.webp")).toBe("shot");
  });
});
