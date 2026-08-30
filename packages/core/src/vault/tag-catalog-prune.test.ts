import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId } from "../util/ids.js";
import { upsertItem, writeItemRawMarkdown } from "./item-operations.js";
import { createVault } from "./vault-operations.js";
import { listTagsOnDisk, readTagsFile, writeTagsFile } from "./tag-io.js";
import {
  pruneTagCatalogCandidates,
  reconcileTagCatalog,
} from "./tag-catalog-prune.js";
import { ensureTagsByName } from "./item-io.js";

function noteMarkdown(args: {
  tagsYaml: string;
  contentRevision: number;
  createdAt: string;
  title?: string;
}): string {
  return [
    "---",
    `title: ${args.title ?? "Note"}`,
    "type: note",
    args.tagsYaml,
    `content_revision: ${args.contentRevision}`,
    `created: ${args.createdAt}`,
    `updated: ${args.createdAt}`,
    "---",
    "",
    "body",
    "",
  ].join("\n");
}

describe("tag catalog prune / reconcile (#935)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tag-prune-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const ctx = { fs, index: new SqlVaultIndexStore(db) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  it("prunes a released tag with zero remaining item_tags refs", async () => {
    const { ctx, meta, path } = await openVault();
    const createdAt = "2024-01-01T00:00:00.000Z";
    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });
    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      noteMarkdown({
        tagsYaml: "tags:\n  - Solo",
        contentRevision: 2,
        createdAt,
      }),
    );
    const before = await listTagsOnDisk(fs, path);
    expect(before.map((t) => t.name)).toEqual(["Solo"]);
    const tagId = before[0]!.id;

    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      noteMarkdown({
        tagsYaml: "tags: []",
        contentRevision: 3,
        createdAt,
      }),
    );

    // Inline path (no job port): write already pruned via refreshItemIndexAfterWrite.
    expect(await listTagsOnDisk(fs, path)).toEqual([]);
    expect(await ctx.index.listOrphanTagIds(meta.id)).toEqual([]);
    expect(await ctx.index.listItemIdsByTag(meta.id, tagId)).toEqual([]);
  });

  it("keeps a tag still used on another document", async () => {
    const { ctx, meta, path } = await openVault();
    const createdAt = "2024-01-01T00:00:00.000Z";
    const a = `${createId()}.md`;
    const b = `${createId()}.md`;
    for (const itemId of [a, b]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: "Note",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: createdAt,
          updated_at: createdAt,
        },
        content: "body",
      });
    }
    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      a,
      noteMarkdown({
        tagsYaml: "tags:\n  - Shared",
        contentRevision: 2,
        createdAt,
        title: "A",
      }),
    );
    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      b,
      noteMarkdown({
        tagsYaml: "tags:\n  - Shared",
        contentRevision: 2,
        createdAt,
        title: "B",
      }),
    );
    const tagId = (await listTagsOnDisk(fs, path)).find(
      (t) => t.name === "Shared",
    )!.id;

    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      a,
      noteMarkdown({
        tagsYaml: "tags: []",
        contentRevision: 3,
        createdAt,
        title: "A",
      }),
    );

    const tags = await listTagsOnDisk(fs, path);
    expect(tags.map((t) => t.name)).toEqual(["Shared"]);
    expect(tags[0]!.id).toBe(tagId);
    expect(await ctx.index.listItemIdsByTag(meta.id, tagId)).toEqual([b]);
  });

  it("full reconcile drops accumulated orphans from tags.json and index", async () => {
    const { ctx, meta, path } = await openVault();
    const orphanId = createId();
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: orphanId,
          name: "Orphan",
          color: null,
          created_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: orphanId,
        name: "Orphan",
        color: null,
        created_at: "2024-01-01T00:00:00.000Z",
      },
      meta.id,
    );

    const result = await reconcileTagCatalog(ctx, path, meta.id);
    expect(result.prunedTagIds).toContain(orphanId);
    expect(await listTagsOnDisk(fs, path)).toEqual([]);
    expect(await ctx.index.listOrphanTagIds(meta.id)).toEqual([]);
  });

  it("concurrent ensure + prune does not clobber creates", async () => {
    const { ctx, meta, path } = await openVault();
    const maps = await ensureTagsByName(fs, path, ["Keep"]);
    const keepId = maps.byName.get("keep")!.id;
    await ctx.index.upsertTag(maps.byId.get(keepId)!, meta.id);

    const staleId = createId();
    await writeTagsFile(fs, path, {
      tags: [
        ...((await readTagsFile(fs, path)).tags),
        {
          id: staleId,
          name: "Stale",
          color: null,
          created_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: staleId,
        name: "Stale",
        color: null,
        created_at: "2024-01-01T00:00:00.000Z",
      },
      meta.id,
    );

    let ensureStarted!: () => void;
    const ensureGate = new Promise<void>((resolve) => {
      ensureStarted = resolve;
    });
    let pruneMayFinish!: () => void;
    const pruneGate = new Promise<void>((resolve) => {
      pruneMayFinish = resolve;
    });

    const originalWrite = fs.writeText.bind(fs);
    let ensureWriteSeen = false;
    vi.spyOn(fs, "writeText").mockImplementation(async (p, text) => {
      if (p.endsWith("tags.json") && text.includes("Fresh") && !ensureWriteSeen) {
        ensureWriteSeen = true;
        ensureStarted();
        await pruneGate;
      }
      return originalWrite(p, text);
    });

    const ensurePromise = ensureTagsByName(fs, path, ["Fresh"]);
    await ensureGate;
    const prunePromise = pruneTagCatalogCandidates(ctx, path, meta.id, [
      staleId,
    ]);
    // Let prune enter the catalog lock queue behind ensure.
    await new Promise((r) => setTimeout(r, 20));
    pruneMayFinish();

    await ensurePromise;
    await prunePromise;

    const tags = await listTagsOnDisk(fs, path);
    const names = tags.map((t) => t.name).sort();
    expect(names).toEqual(["Fresh", "Keep"]);
    expect(names).not.toContain("Stale");
  });

  it("write with tagCatalogPruneJobs only enqueues (no inline prune)", async () => {
    const { ctx: base, meta, path } = await openVault();
    const enqueued: Array<readonly string[] | undefined> = [];
    const ctx = {
      ...base,
      tagCatalogPruneJobs: {
        enqueue: async (
          _vaultId: string,
          _vaultPath: string,
          candidateTagIds?: readonly string[],
        ) => {
          enqueued.push(candidateTagIds);
        },
      },
    };
    const createdAt = "2024-01-01T00:00:00.000Z";
    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      content: "body",
    });
    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      noteMarkdown({
        tagsYaml: "tags:\n  - Temp",
        contentRevision: 2,
        createdAt,
      }),
    );
    const tagId = (await listTagsOnDisk(fs, path)).find(
      (t) => t.name === "Temp",
    )!.id;
    enqueued.length = 0;

    await writeItemRawMarkdown(
      ctx,
      path,
      meta.id,
      itemId,
      noteMarkdown({
        tagsYaml: "tags: []",
        contentRevision: 3,
        createdAt,
      }),
    );

    // Without itemDerivedRefreshJobs, index refresh is inline and schedules prune.
    expect(enqueued).toEqual([[tagId]]);
    // Catalog still has Temp until the job drains.
    expect((await listTagsOnDisk(fs, path)).map((t) => t.name)).toEqual([
      "Temp",
    ]);
  });
});
