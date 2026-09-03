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
    expect(before.map((t) => t.name)).toEqual(["solo"]);
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
      (t) => t.name === "shared",
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
    expect(tags.map((t) => t.name)).toEqual(["shared"]);
    expect(tags[0]!.id).toBe(tagId);
    expect(await ctx.index.listItemIdsByTag(meta.id, tagId)).toEqual([b]);
  });

  it("full reconcile merges similarity clones onto winner (#943)", async () => {
    const { ctx, meta, path } = await openVault();
    const winnerId = createId();
    const loserId = createId();
    const createdEarly = "2024-01-01T00:00:00.000Z";
    const createdLate = "2024-06-01T00:00:00.000Z";
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: winnerId,
          name: "web-dev",
          color: null,
          created_at: createdEarly,
        },
        {
          id: loserId,
          name: "web_dev",
          color: null,
          created_at: createdLate,
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: winnerId,
        name: "web-dev",
        color: null,
        created_at: createdEarly,
      },
      meta.id,
    );
    await ctx.index.upsertTag(
      {
        id: loserId,
        name: "web_dev",
        color: null,
        created_at: createdLate,
      },
      meta.id,
    );

    const winnerItem = `${createId()}.md`;
    const loserItem = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: winnerItem,
        vault_id: meta.id,
        title: "Winner note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [winnerId],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdEarly,
        updated_at: createdEarly,
      },
      content: "body",
      deferIndexRefresh: true,
    });
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: loserItem,
        vault_id: meta.id,
        title: "Loser note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [loserId],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdLate,
        updated_at: createdLate,
      },
      content: "body",
      deferIndexRefresh: true,
    });

    const first = await reconcileTagCatalog(ctx, path, meta.id);
    expect(first.prunedTagIds).toContain(loserId);

    const tags = await listTagsOnDisk(fs, path);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.id).toBe(winnerId);
    expect(tags[0]?.name).toBe("web-dev");

    expect(await ctx.index.listItemIdsByTag(meta.id, winnerId)).toEqual(
      expect.arrayContaining([winnerItem, loserItem]),
    );
    expect(await ctx.index.listItemIdsByTag(meta.id, loserId)).toEqual([]);

    const { readItemRawMarkdown } = await import("./item-io.js");
    const loserMd = await readItemRawMarkdown(fs, path, loserItem);
    expect(loserMd).toContain("web-dev");
    expect(loserMd).not.toContain("web_dev");

    const second = await reconcileTagCatalog(ctx, path, meta.id);
    expect(second.prunedTagIds).not.toContain(loserId);
    expect(await listTagsOnDisk(fs, path)).toHaveLength(1);
  });

  it("full reconcile picks winner by item_count (#943)", async () => {
    const { ctx, meta, path } = await openVault();
    const earlyId = createId();
    const lateId = createId();
    const createdEarly = "2024-01-01T00:00:00.000Z";
    const createdLate = "2024-06-01T00:00:00.000Z";
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: earlyId,
          name: "web-dev",
          color: null,
          created_at: createdEarly,
        },
        {
          id: lateId,
          name: "web_dev",
          color: null,
          created_at: createdLate,
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: earlyId,
        name: "web-dev",
        color: null,
        created_at: createdEarly,
      },
      meta.id,
    );
    await ctx.index.upsertTag(
      {
        id: lateId,
        name: "web_dev",
        color: null,
        created_at: createdLate,
      },
      meta.id,
    );

    const earlyItem = `${createId()}.md`;
    const lateA = `${createId()}.md`;
    const lateB = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: earlyItem,
        vault_id: meta.id,
        title: "Early",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [earlyId],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdEarly,
        updated_at: createdEarly,
      },
      content: "body",
      deferIndexRefresh: true,
    });
    for (const itemId of [lateA, lateB]) {
      await upsertItem(ctx, path, meta.id, {
        item: {
          id: itemId,
          vault_id: meta.id,
          title: "Late",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [lateId],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: createdLate,
          updated_at: createdLate,
        },
        content: "body",
        deferIndexRefresh: true,
      });
    }

    await reconcileTagCatalog(ctx, path, meta.id);
    const tags = await listTagsOnDisk(fs, path);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.id).toBe(lateId);
    expect(tags[0]?.name).toBe("web_dev");
    expect(
      (await ctx.index.listItemIdsByTag(meta.id, lateId)).sort(),
    ).toEqual([earlyItem, lateA, lateB].sort());
  });

  it("full reconcile rewrites FM when index already collapsed to map winner (#943)", async () => {
    const { ctx, meta, path } = await openVault();
    const mapWinnerId = createId();
    const loserId = createId();
    const createdEarly = "2024-01-01T00:00:00.000Z";
    const createdLate = "2024-06-01T00:00:00.000Z";
    await writeTagsFile(fs, path, {
      tags: [
        {
          id: mapWinnerId,
          name: "web-dev",
          color: null,
          created_at: createdEarly,
        },
        {
          id: loserId,
          name: "web_dev",
          color: null,
          created_at: createdLate,
        },
      ],
    });
    await ctx.index.upsertTag(
      {
        id: mapWinnerId,
        name: "web-dev",
        color: null,
        created_at: createdEarly,
      },
      meta.id,
    );
    await ctx.index.upsertTag(
      {
        id: loserId,
        name: "web_dev",
        color: null,
        created_at: createdLate,
      },
      meta.id,
    );

    // Simulate post-sync: item_tags already on map-preferred id, FM still loser name.
    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Collapsed",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [mapWinnerId],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: createdEarly,
        updated_at: createdEarly,
      },
      content: "body",
      deferIndexRefresh: true,
    });
    const { itemMarkdownPath } = await import("./paths.js");
    await fs.writeText(
      itemMarkdownPath(path, itemId),
      noteMarkdown({
        tagsYaml: "tags:\n  - web_dev",
        contentRevision: 1,
        createdAt: createdEarly,
        title: "Collapsed",
      }),
    );

    await reconcileTagCatalog(ctx, path, meta.id);

    const tags = await listTagsOnDisk(fs, path);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.id).toBe(mapWinnerId);

    const { readItemRawMarkdown } = await import("./item-io.js");
    const md = await readItemRawMarkdown(fs, path, itemId);
    expect(md).toContain("web-dev");
    expect(md).not.toMatch(/web_dev/);
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
      if (p.endsWith("tags.json") && text.includes("fresh") && !ensureWriteSeen) {
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
    expect(names).toEqual(["fresh", "keep"]);
    expect(names).not.toContain("Stale");
    expect(names).not.toContain("stale");
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
      (t) => t.name === "temp",
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
    // Catalog still has temp until the job drains.
    expect((await listTagsOnDisk(fs, path)).map((t) => t.name)).toEqual([
      "temp",
    ]);
  });
});
