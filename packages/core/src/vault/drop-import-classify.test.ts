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

const byRelPath = (a: string, b: string) => a.localeCompare(b);

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
  if (relDir) {
    return out;
  }
  return out.sort(byRelPath);
}

type ExpectedImport = { contentType: ContentType; title: string };

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

    const expected: Record<string, ExpectedImport | "skip"> = {
      "a.png": { contentType: "image", title: "a" },
      "clip.mp4": { contentType: "video", title: "clip" },
      "doc.pdf": { contentType: "pdf", title: "doc" },
      "track.mp3": { contentType: "audio", title: "track" },
      "shot.webp": { contentType: "image", title: "shot" },
      "note.md": { contentType: "note", title: "note" },
      "Trip/nested/x.MD": { contentType: "note", title: "x" },
      "with-title.md": { contentType: "note", title: "From FM" },
      "foreign.md": { contentType: "note", title: "From FM" },
      "virus.exe": "skip",
      "readme.txt": "skip",
    };

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
    expect(discovered).toEqual(files.map((f) => f.rel).sort(byRelPath));

    const timestamp = new Date().toISOString();
    const imported: Array<{ itemId: string; want: ExpectedImport }> = [];

    for (const rel of discovered) {
      const want = expected[rel];
      if (want === undefined) {
        throw new Error(`unexpected drop file discovered on disk: ${rel}`);
      }

      const classified = classifyDropFilename(rel);
      if (want === "skip") {
        expect(classified).toEqual({ kind: "skip" });
        continue;
      }

      const itemId = `Inbox/${createId()}.md`;
      let content = "";
      let title: string;
      let contentType: ContentType;

      if (classified.kind === "note") {
        const raw = await fs.readText(joinSegments(dropRoot, rel));
        title = resolveDropTitle(rel, raw);
        contentType = "note";
        content = raw;
      } else if (classified.kind === "media") {
        title = titleStemFromFilename(rel);
        contentType = classified.contentType;
      } else {
        throw new Error(`expected importable classify for ${rel}, got skip`);
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
      imported.push({ itemId, want });
    }

    expect(
      discovered.filter((rel) => expected[rel] === "skip").sort(byRelPath),
    ).toEqual(["readme.txt", "virus.exe"]);
    expect(imported).toHaveLength(
      Object.values(expected).filter((v) => v !== "skip").length,
    );

    const rows = await ctx.index.listItemFilesByIds(
      meta.id,
      imported.map((row) => row.itemId),
    );
    expect(rows).toHaveLength(imported.length);
    for (const { itemId, want } of imported) {
      const row = rows.find((r) => r.id === itemId);
      expect(row?.title).toBe(want.title);
      expect(row?.content_type).toBe(want.contentType);
      expect(row?.source_type).toBe("import");
    }

    expect(await ctx.index.listVaultItemIds(meta.id)).toHaveLength(imported.length);
  });
});
