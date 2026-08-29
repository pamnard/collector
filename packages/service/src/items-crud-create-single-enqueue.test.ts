import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  itemMarkdownPath,
  readItemFile,
  readItemRawMarkdown,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import {
  itemDerivedRefreshIdempotencyKeyPrefix,
  itemDerivedRefreshJobType,
} from "@collector/shared";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";
import { enqueueItemDerivedRefresh } from "./jobs/handlers/item-derived-refresh.js";
import { createJobQueue, type JobQueue } from "./jobs/job-queue.js";
import { createJobRegistry } from "./jobs/job-registry.js";

describe("createItemsCrud single derived enqueue (#776)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();
  const queues: JobQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("create with remote assets writes vault item and enqueues one itemDerivedRefresh in jobs.db", async () => {
    dataDir = await mkdtemp(
      join(tmpdir(), "collector-create-single-enqueue-"),
    );
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({
      status: "ok",
    }));
    const queue = await createJobQueue({
      dbPath: join(dataDir, "jobs.db"),
      registry,
    });
    queues.push(queue);

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async (input) => {
          await enqueueItemDerivedRefresh(queue, input);
        },
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => crypto.randomUUID(),
    );

    const remoteBody = "![x](https://cdn.example/x.png)\n";
    const created = await crud.createItem({
      title: "Remote",
      content_type: "note",
      content: remoteBody,
    });

    const fromDisk = await readItemFile(fs, path, created.id, meta.id);
    expect(fromDisk.id).toBe(created.id);
    expect(fromDisk.title).toBe("Remote");
    const raw = await readItemRawMarkdown(fs, path, created.id);
    expect(raw).toContain("https://cdn.example/x.png");

    const docStat = await fs.stat(itemMarkdownPath(path, created.id));
    if (docStat.mtimeMs === null) {
      throw new Error(`missing mtime for ${created.id}`);
    }

    const stats = await queue.stats();
    expect(stats.pending).toBe(1);
    expect(stats.byType.itemDerivedRefresh).toMatchObject({
      pending: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
    });

    const job = await queue.findLatestByIdempotencyKeyPrefix(
      itemDerivedRefreshIdempotencyKeyPrefix({
        vaultId: meta.id,
        itemId: created.id,
        contentRevision: created.content_revision,
      }),
    );
    expect(job).not.toBeNull();
    expect(job!.type).toBe(itemDerivedRefreshJobType.id);
    expect(job!.status).toBe("pending");
    expect(JSON.parse(job!.payload_json)).toEqual({
      vaultId: meta.id,
      vaultPath: path,
      itemId: created.id,
      contentRevision: created.content_revision,
      fileMtimeMs: docStat.mtimeMs,
      itemUrl: null,
    });
  });
});
