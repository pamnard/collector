import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqlVaultIndexStore,
  attachMediaFile,
  createFolder,
  createVault,
  listItemMediaWithPaths,
  readItemFile,
  resolveOrCreateInboxFolder,
  writeItemRawMarkdown,
  upsertItem,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import type { CreateItemInput } from "@collector/api";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createDropImportService } from "./drop-import.js";

describe("drop import vault integration (#22)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("imports png + md with FM title; skips exe; mirrors Trip under Projects", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-drop-import-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    await resolveOrCreateInboxFolder(ctx, path);

    const createItem = async (input: CreateItemInput) => {
      const timestamp = new Date().toISOString();
      let folderPath = input.folder_path?.trim() ?? "";
      if (!folderPath) {
        folderPath = await resolveOrCreateInboxFolder(ctx, path);
      } else {
        await createFolder(ctx, path, folderPath);
      }
      const id = `${folderPath}/${crypto.randomUUID()}.md`;
      return upsertItem(ctx, path, meta.id, {
        item: {
          id,
          vault_id: meta.id,
          title: input.title,
          description: "",
          url: null,
          content_type: input.content_type,
          source_type: input.source_type ?? "manual",
          metadata: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: folderPath,
          content_revision: 1,
          created_at: timestamp,
          updated_at: timestamp,
        },
        content: input.content ?? null,
      });
    };

    const service = createDropImportService({
      createItem,
      attachMediaFiles: async (itemId, files) => {
        const out = [];
        for (const file of files) {
          out.push(
            await attachMediaFile(ctx, path, itemId, {
              filename: file.filename,
              data: file.data,
            }),
          );
        }
        return out;
      },
      updateItemSource: (itemId, raw) =>
        writeItemRawMarkdown(ctx, path, meta.id, itemId, raw),
    });

    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const md = new TextEncoder().encode("---\ntitle: From FM\n---\n\nBody\n");
    const result = await service.importDroppedFiles({
      folder_path: "Projects",
      files: [
        {
          relativePath: "Trip/shot.png",
          filename: "shot.png",
          data: png,
        },
        {
          relativePath: "Trip/notes/x.md",
          filename: "x.md",
          data: md,
        },
        {
          relativePath: "Trip/bad.exe",
          filename: "bad.exe",
          data: new Uint8Array([1]),
        },
      ],
    });

    expect(result.createdIds).toHaveLength(2);

    const items = await Promise.all(
      result.createdIds.map((id) => readItemFile(fs, path, id, meta.id)),
    );
    const imageItem = items.find((item) => item.content_type === "image");
    const noteItem = items.find((item) => item.content_type === "note");
    expect(imageItem).toBeTruthy();
    expect(noteItem).toBeTruthy();

    expect(imageItem!.source_type).toBe("import");
    expect(imageItem!.folder_path).toBe("Projects/Trip");
    expect(imageItem!.title).toBe("shot");
    const media = await listItemMediaWithPaths(ctx, path, imageItem!.id);
    expect(media).toHaveLength(1);
    expect(media[0]?.filename).toBe("shot.png");

    expect(noteItem!.title).toBe("From FM");
    expect(noteItem!.folder_path).toBe("Projects/Trip/notes");
    expect(noteItem!.source_type).toBe("import");
  });
});
