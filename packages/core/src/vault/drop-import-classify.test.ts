import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  classifyDropFilename,
  titleStemFromFilename,
} from "./drop-import-classify.js";
import { resolveDropTitle } from "./resolve-drop-title.js";
import { joinSegments } from "./paths.js";

describe("drop-import-classify against temp drop folder", () => {
  let dropRoot = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dropRoot) {
      await rm(dropRoot, { recursive: true, force: true });
      dropRoot = "";
    }
  });

  it("classifies real filenames from disk; skips unsupported", async () => {
    dropRoot = await mkdtemp(join(tmpdir(), "collector-drop-classify-"));

    const files: Array<{ rel: string; bytes?: Uint8Array; text?: string }> = [
      { rel: "a.png", bytes: Uint8Array.from([1]) },
      { rel: "clip.mp4", bytes: Uint8Array.from([2]) },
      { rel: "doc.pdf", bytes: Uint8Array.from([3]) },
      { rel: "track.mp3", bytes: Uint8Array.from([4]) },
      { rel: "note.md", text: "# note\n" },
      { rel: "Trip/nested/x.MD", text: "# nested\n" },
      { rel: "virus.exe", bytes: Uint8Array.from([5]) },
      { rel: "readme.txt", text: "plain\n" },
    ];

    for (const file of files) {
      const abs = join(dropRoot, ...file.rel.split("/"));
      await mkdir(dirname(abs), { recursive: true });
      if (file.text !== undefined) {
        await writeFile(abs, file.text, "utf8");
      } else if (file.bytes) {
        await writeFile(abs, file.bytes);
      }
    }

    const topNames = (await fs.readDirEntries(dropRoot)).map((e) => e.name).sort();
    expect(topNames).toEqual(
      ["Trip", "a.png", "clip.mp4", "doc.pdf", "note.md", "readme.txt", "track.mp3", "virus.exe"].sort(),
    );

    const expected: Record<string, ReturnType<typeof classifyDropFilename>> = {
      "a.png": { kind: "media", contentType: "image", mediaType: "image" },
      "clip.mp4": { kind: "media", contentType: "video", mediaType: "video" },
      "doc.pdf": { kind: "media", contentType: "pdf", mediaType: "pdf" },
      "track.mp3": { kind: "media", contentType: "audio", mediaType: "audio" },
      "note.md": { kind: "note" },
      "Trip/nested/x.MD": { kind: "note" },
      "virus.exe": { kind: "skip" },
      "readme.txt": { kind: "skip" },
    };

    for (const file of files) {
      expect(await fs.exists(joinSegments(dropRoot, file.rel))).toBe(true);
      expect(classifyDropFilename(file.rel)).toEqual(expected[file.rel]);
    }
  });

  it("titleStemFromFilename strips extension from basenames on disk", async () => {
    dropRoot = await mkdtemp(join(tmpdir(), "collector-drop-stem-"));
    await writeFile(join(dropRoot, "photo.png"), Uint8Array.from([1]));
    await mkdir(join(dropRoot, "Trip"), { recursive: true });
    await writeFile(join(dropRoot, "Trip", "a.b.md"), "# x\n", "utf8");

    expect(titleStemFromFilename("photo.png")).toBe("photo");
    expect(titleStemFromFilename("Trip/a.b.md")).toBe("a.b");
    expect(await fs.exists(join(dropRoot, "photo.png"))).toBe(true);
    expect(await fs.exists(join(dropRoot, "Trip", "a.b.md"))).toBe(true);
  });

  it("resolveDropTitle reads markdown title from disk contents", async () => {
    dropRoot = await mkdtemp(join(tmpdir(), "collector-drop-title-"));
    const withTitle = join(dropRoot, "ignored.md");
    const foreign = join(dropRoot, "foreign.md");
    const noTitle = join(dropRoot, "my-note.md");
    const shot = join(dropRoot, "shot.webp");

    await writeFile(withTitle, "---\ntitle: From FM\n---\n\nBody\n", "utf8");
    await writeFile(
      foreign,
      `---
title: From FM
type: agentic-pattern
content_type: not-a-real-type
---
Body
`,
      "utf8",
    );
    await writeFile(noTitle, "# Hello\n", "utf8");
    await writeFile(shot, Uint8Array.from([9]));

    expect(resolveDropTitle("ignored.md", await readFile(withTitle, "utf8"))).toBe("From FM");
    expect(resolveDropTitle("foreign.md", await readFile(foreign, "utf8"))).toBe("From FM");
    expect(resolveDropTitle("my-note.md", await readFile(noTitle, "utf8"))).toBe("my-note");
    expect(resolveDropTitle("shot.webp")).toBe("shot");
  });
});
