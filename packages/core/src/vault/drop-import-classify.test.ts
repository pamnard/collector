import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentType } from "@collector/shared";
import type { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  createSqlIndexTestSuite,
  noteItemFields,
} from "../index/sql-index-test-harness.js";
import { createId } from "../util/ids.js";
import {
  classifyDropFilename,
  titleStemFromFilename,
} from "./drop-import-classify.js";
import { upsertItem } from "./item-operations.js";
import { joinSegments } from "./paths.js";
import { resolveDropTitle } from "./resolve-drop-title.js";

/** All file paths under a drop root, relative, posix, sorted. */
async function listDropRelativeFiles(
  fs: NodeFileSystemAdapter,
  dropRoot: string,
  relDir = "",
): Promise<string[]> {
  const absDir = relDir ? joinSegments(dropRoot, relDir) : dropRoot;
  const out: string[] = [];
  for (const entry of await fs.readDirEntries(absDir)) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      out.push(...(await listDropRelativeFiles(fs, dropRoot, rel)));
      continue;
    }
    out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

describe("drop-import-classify against temp drop folder + vault index", () => {
  const suite = createSqlIndexTestSuite();
  suite.registerCleanup();

  it("imports classified disk files into the index; skips unsupported", async () => {
    const { ctx, fs, vault, dataDir } = await suite.openVaultIndex(
      "collector-drop-classify-",
    );
    const { meta, path } = vault;
    const dropRoot = join(dataDir, "drop");
    await mkdir(dropRoot, { recursive: true });

    const files: Array<{ rel: string; bytes?: Uint8Array; text?: string }> = [
      { rel: "a.png", bytes: Uint8Array.from([1]) },
      { rel: "clip.mp4", bytes: Uint8Array.from([2]) },
      { rel: "doc.pdf", bytes: Uint8Array.from([3]) },
      { rel: "track.mp3", bytes: Uint8Array.from([4]) },
      { rel: "note.md", text: "# note\n" },
      { rel: "Trip/nested/x.MD", text: "# nested\n" },
      { rel: "with-title.md", text: "---\ntitle: From FM\n---\n\nBody\n" },
      {
        rel: "foreign.md",
        text: `---
title: From FM
type: agentic-pattern
content_type: not-a-real-type
---
Body
`,
      },
      { rel: "virus.exe", bytes: Uint8Array.from([5]) },
      { rel: "readme.txt", text: "plain\n" },
      { rel: "shot.webp", bytes: Uint8Array.from([9]) },
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

    const discovered = await listDropRelativeFiles(fs, dropRoot);
    expect(discovered).toEqual(
      [
        "Trip/nested/x.MD",
        "a.png",
        "clip.mp4",
        "doc.pdf",
        "foreign.md",
        "note.md",
        "readme.txt",
        "shot.webp",
        "track.mp3",
        "virus.exe",
        "with-title.md",
      ].sort((a, b) => a.localeCompare(b)),
    );

    const timestamp = new Date().toISOString();
    const imported: Array<{
      rel: string;
      itemId: string;
      contentType: ContentType;
      title: string;
    }> = [];
    const skipped: string[] = [];

    for (const rel of discovered) {
      expect(await fs.exists(joinSegments(dropRoot, rel))).toBe(true);
      const classified = classifyDropFilename(rel);
      if (classified.kind === "skip") {
        skipped.push(rel);
        continue;
      }

      const itemId = `Inbox/${createId()}.md`;
      let title: string;
      let contentType: ContentType;
      let content = "";

      if (classified.kind === "note") {
        const raw = await fs.readText(joinSegments(dropRoot, rel));
        title = resolveDropTitle(rel, raw);
        contentType = "note";
        content = raw;
      } else {
        title = titleStemFromFilename(rel);
        contentType = classified.contentType;
      }

      await upsertItem(ctx, path, meta.id, {
        item: noteItemFields(meta.id, itemId, {
          title,
          content_type: contentType,
          source_type: "import",
          folder_path: "Inbox",
          created_at: timestamp,
          updated_at: timestamp,
        }),
        content,
      });
      imported.push({ rel, itemId, contentType, title });
    }

    const byRelPath = (a: string, b: string) => a.localeCompare(b);
    expect(skipped.sort(byRelPath)).toEqual(["readme.txt", "virus.exe"]);
    expect(imported.map((row) => row.rel).sort(byRelPath)).toEqual(
      [
        "Trip/nested/x.MD",
        "a.png",
        "clip.mp4",
        "doc.pdf",
        "foreign.md",
        "note.md",
        "shot.webp",
        "track.mp3",
        "with-title.md",
      ].sort(byRelPath),
    );

    const byRel = new Map(imported.map((row) => [row.rel, row]));
    expect(byRel.get("a.png")).toMatchObject({
      contentType: "image",
      title: "a",
    });
    expect(byRel.get("clip.mp4")).toMatchObject({
      contentType: "video",
      title: "clip",
    });
    expect(byRel.get("doc.pdf")).toMatchObject({
      contentType: "pdf",
      title: "doc",
    });
    expect(byRel.get("track.mp3")).toMatchObject({
      contentType: "audio",
      title: "track",
    });
    expect(byRel.get("shot.webp")).toMatchObject({
      contentType: "image",
      title: "shot",
    });
    expect(byRel.get("note.md")).toMatchObject({
      contentType: "note",
      title: "note",
    });
    expect(byRel.get("Trip/nested/x.MD")).toMatchObject({
      contentType: "note",
      title: "x",
    });
    expect(byRel.get("with-title.md")).toMatchObject({
      contentType: "note",
      title: "From FM",
    });
    expect(byRel.get("foreign.md")).toMatchObject({
      contentType: "note",
      title: "From FM",
    });

    const rows = await ctx.index.listItemFilesByIds(
      meta.id,
      imported.map((row) => row.itemId),
    );
    expect(rows).toHaveLength(imported.length);
    for (const expected of imported) {
      const row = rows.find((r) => r.id === expected.itemId);
      expect(row?.title).toBe(expected.title);
      expect(row?.content_type).toBe(expected.contentType);
      expect(row?.source_type).toBe("import");
    }

    expect(await ctx.index.listVaultItemIds(meta.id)).toHaveLength(imported.length);
  });
});
