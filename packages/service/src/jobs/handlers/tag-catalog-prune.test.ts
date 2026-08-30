import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@collector/db";
import {
  tagCatalogPruneFullIdempotencyKey,
  tagCatalogPruneJobType,
} from "@collector/shared";
import { BetterSqliteMigrator } from "../../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "@collector/core/node";
import {
  SqlVaultIndexStore,
  createVault,
  upsertItem,
  writeItemRawMarkdown,
  listTagsOnDisk,
} from "@collector/core";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createTagCatalogPruneHandler,
  enqueueTagCatalogPrune,
} from "./tag-catalog-prune.js";
import { createVaultIndexSyncHandler } from "./vault-index-sync.js";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor timed out");
}

function noteMarkdown(args: {
  tagsYaml: string;
  contentRevision: number;
  createdAt: string;
}): string {
  return [
    "---",
    "title: Note",
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

describe("tagCatalogPrune job (#935)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];
  const fs = new NodeFileSystemAdapter();
  let db: BetterSqliteMigrator | null = null;
  let dataDir = "";

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
    vi.restoreAllMocks();
  });

  it("parses optional candidateTagIds and full reconcile key", () => {
    expect(
      tagCatalogPruneJobType.payload.parse({
        vaultId: "v",
        vaultPath: "/p",
        candidateTagIds: ["a"],
      }),
    ).toEqual({
      vaultId: "v",
      vaultPath: "/p",
      candidateTagIds: ["a"],
    });
    expect(tagCatalogPruneFullIdempotencyKey("v1")).toBe(
      "tagCatalogPrune:v1:full",
    );
  });

  it("enqueue → drain removes unused tag from tags.json and index", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-tag-prune-job-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const index = new SqlVaultIndexStore(db);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const createdAt = "2024-01-01T00:00:00.000Z";
    const itemId = `${crypto.randomUUID()}.md`;
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
        tagsYaml: "tags:\n  - Gone",
        contentRevision: 2,
        createdAt,
      }),
    );
    const tagId = (await listTagsOnDisk(fs, path)).find(
      (t) => t.name === "Gone",
    )!.id;

    // Simulate released refs without inline prune: clear item tags in index
    // and leave tags.json + tags row (as if write enqueued prune only).
    const [item] = await index.listItemFilesByIds(meta.id, [itemId]);
    await index.upsertItem(
      {
        item: { ...item!, tag_ids: [] },
        content: "body",
        hasContentFile: true,
        sourceRef: null,
        fileMtimeMs: 1,
      },
      meta.id,
    );
    expect((await listTagsOnDisk(fs, path)).map((t) => t.name)).toEqual([
      "Gone",
    ]);

    const jobDir = mkdtempSync(join(tmpdir(), "collector-tag-prune-jobs-"));
    dirs.push(jobDir);
    const registry = createJobRegistry([tagCatalogPruneJobType]);
    registry.register(
      tagCatalogPruneJobType,
      createTagCatalogPruneHandler({ getContext: () => ctx }),
    );
    const queue = await createJobQueue({
      dbPath: join(jobDir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    await enqueueTagCatalogPrune(queue, {
      vaultId: meta.id,
      vaultPath: path,
      candidateTagIds: [tagId],
    });
    await waitFor(async () => (await queue.stats()).succeeded >= 1);

    expect(await listTagsOnDisk(fs, path)).toEqual([]);
    expect(await index.listOrphanTagIds(meta.id)).toEqual([]);
  });

  it("vaultIndexSync enqueues full reconcile after sync (not sync-thread FS prune)", async () => {
    const startVaultIndexSync = vi.fn(async () => undefined);
    const enqueueTagCatalogReconcile = vi.fn(async () => undefined);
    const handler = createVaultIndexSyncHandler({
      startVaultIndexSync,
      enqueueTagCatalogReconcile,
    });

    await expect(
      handler({
        id: "job-1",
        type: "vaultIndexSync",
        attempts: 0,
        payload: {
          vaultId: "vault-1",
          vaultPath: "/vault",
          reason: "force",
        },
      }),
    ).resolves.toEqual({ status: "ok" });

    expect(startVaultIndexSync).toHaveBeenCalledWith("vault-1", "/vault");
    expect(enqueueTagCatalogReconcile).toHaveBeenCalledWith(
      "vault-1",
      "/vault",
    );
  });

  it("full reconcile job coalesces by vault id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-tag-prune-full-"));
    dirs.push(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);
    vi.spyOn(
      await import("@collector/core"),
      "runTagCatalogPrune",
    ).mockImplementation(async () => {
      await run();
      return { prunedTagIds: [] };
    });

    const registry = createJobRegistry([tagCatalogPruneJobType]);
    registry.register(
      tagCatalogPruneJobType,
      createTagCatalogPruneHandler({
        getContext: () => ({}) as never,
      }),
    );
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueTagCatalogPrune(queue, {
      vaultId: "vault-1",
      vaultPath: "/vault",
    });
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueTagCatalogPrune(queue, {
      vaultId: "vault-1",
      vaultPath: "/vault",
    });
    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
  });
});
