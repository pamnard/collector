import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  upsertItem,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import {
  isStaleItemDerivedLocalizeJob,
  runItemDerivedLocalizeRefresh,
} from "./item-derived-localize.js";

describe("runItemDerivedLocalizeRefresh (#768)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("localizes markdown in the worker and bumps content_revision", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-derived-localize-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const remoteUrl = "https://cdn.example/hero.png";

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Remote",
        description: "",
        url: null,
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      content: `![hero](${remoteUrl})`,
    });

    const docPath = join(path, itemId);
    const fileStat = await fs.stat(docPath);
    if (fileStat.mtimeMs === null) {
      throw new Error("missing mtime");
    }

    const localize = vi.fn(async ({ rawMarkdown }) => ({
      text: rawMarkdown.replace(remoteUrl, "media/local/hero.png"),
      changed: true,
    }));

    const outcome = await runItemDerivedLocalizeRefresh(
      ctx,
      {
        vaultId: meta.id,
        vaultPath: path,
        itemId,
        contentRevision: 1,
        fileMtimeMs: fileStat.mtimeMs,
      },
      localize,
    );

    expect(outcome).toBe("markdown");
    expect(localize).toHaveBeenCalledTimes(1);
    const onDisk = await readItemRawMarkdown(fs, path, itemId);
    expect(onDisk).toContain("media/local/hero.png");
    expect(onDisk).toContain("content_revision: 2");
    const indexed = await index.listItemFilesByIds(meta.id, [itemId]);
    expect(indexed[0]?.content_revision).toBe(1);
  });

  it("skips stale jobs when a newer revision is already indexed", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-derived-stale-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;

    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Fresh",
        description: "",
        url: null,
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 3,
        word_count: 0,
        character_count: 0,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
      content: "![x](https://cdn.example/x.png)",
    });

    const localize = vi.fn(async ({ rawMarkdown }) => ({
      text: rawMarkdown,
      changed: false,
    }));

    const outcome = await runItemDerivedLocalizeRefresh(
      ctx,
      {
        vaultId: meta.id,
        vaultPath: path,
        itemId,
        contentRevision: 1,
        fileMtimeMs: 0,
      },
      localize,
    );

    expect(outcome).toBe("stale");
    expect(localize).not.toHaveBeenCalled();
  });
});

describe("isStaleItemDerivedLocalizeJob", () => {
  it("detects newer indexed revision and mtime", () => {
    expect(
      isStaleItemDerivedLocalizeJob(
        {
          id: "a.md",
          content_revision: 4,
          file_mtime_ms: 200,
          updated_at: "t",
          created_at: "t",
        },
        { contentRevision: 3, fileMtimeMs: 100 },
      ),
    ).toBe(true);
    expect(
      isStaleItemDerivedLocalizeJob(
        {
          id: "a.md",
          content_revision: 2,
          file_mtime_ms: 250,
          updated_at: "t",
          created_at: "t",
        },
        { contentRevision: 2, fileMtimeMs: 200 },
      ),
    ).toBe(true);
    expect(
      isStaleItemDerivedLocalizeJob(
        {
          id: "a.md",
          content_revision: 2,
          file_mtime_ms: 200,
          updated_at: "t",
          created_at: "t",
        },
        { contentRevision: 2, fileMtimeMs: 200 },
      ),
    ).toBe(false);
  });
});
