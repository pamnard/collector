import { describe, expect, it } from "vitest";
import {
  buildItemPrintModel,
  classifyInlineMediaSrc,
  filenameFromMediaSrc,
  safePdfBasename,
  splitMarkdownBodyParts,
} from "./item-print-model.js";

describe("item-print-model (#304)", () => {
  it("classifies inline image / video / audio / pdf destinations", () => {
    expect(classifyInlineMediaSrc("media/u/shot.png", "a")).toEqual({
      kind: "image",
      src: "media/u/shot.png",
      alt: "a",
    });
    expect(classifyInlineMediaSrc("media/u/clip.mp4", "v")).toMatchObject({
      kind: "videoStill",
      filename: "clip.mp4",
    });
    expect(classifyInlineMediaSrc("media/u/track.mp3", "")).toMatchObject({
      kind: "placeholder",
      mediaType: "audio",
      filename: "track.mp3",
    });
    expect(classifyInlineMediaSrc("media/u/doc.pdf", "")).toMatchObject({
      kind: "placeholder",
      mediaType: "pdf",
      filename: "doc.pdf",
    });
  });

  it("splits body so gallery-only names are not referenced", () => {
    const body =
      "Intro\n\n![hero](media/u/inline.png)\n\n![clip](media/u/clip.mp4)\n\n![song](media/u/a.mp3)\n";
    const parts = splitMarkdownBodyParts(body);
    const model = buildItemPrintModel({
      title: "Note",
      body,
      heroSrc: "/vault/media/u/cover.webp",
    });
    expect(model.hero?.src).toBe("/vault/media/u/cover.webp");
    expect(model.title).toBe("Note");
    expect(model.referencedFilenames).toEqual([
      "inline.png",
      "clip.mp4",
      "a.mp3",
    ]);
    expect(model.referencedFilenames).not.toContain("gallery-only.jpg");
    expect(parts.some((p) => p.kind === "media" && p.media.kind === "image")).toBe(
      true,
    );
    expect(
      parts.some((p) => p.kind === "media" && p.media.kind === "videoStill"),
    ).toBe(true);
    expect(
      parts.some(
        (p) =>
          p.kind === "media" &&
          p.media.kind === "placeholder" &&
          p.media.mediaType === "audio",
      ),
    ).toBe(true);
  });

  it("filenameFromMediaSrc strips query and path", () => {
    expect(filenameFromMediaSrc("media/u/a.png?x=1")).toBe("a.png");
    expect(filenameFromMediaSrc("/abs/path/b.webp")).toBe("b.webp");
  });

  it("safePdfBasename sanitizes title for download", () => {
    expect(safePdfBasename('Hello / "World"', "Inbox/x.md")).toBe(
      "Hello _ _World_",
    );
    expect(safePdfBasename("  ", "Inbox/note.md")).toBe("note");
  });
});
