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
  resolveOrCreateInboxFolder,
  upsertItem,
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

describe("createItemsCrud async localize (#768)", () => {
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

  it("updateItemSource with remote assets leaves item on disk and enqueues itemDerivedRefresh in jobs.db", async () => {
    dataDir = await mkdtemp(
      join(tmpdir(), "collector-async-localize-"),
    );
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const remoteBody = "![x](https://cdn.example/x.png)\n";

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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: remoteBody,
    });

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
      () => "unused",
    );

    const existingRaw = await readItemRawMarkdown(fs, path, itemId);
    const updated = await crud.updateItemSource(itemId, existingRaw);

    const fromDisk = await readItemFile(fs, path, itemId, meta.id);
    expect(fromDisk.id).toBe(itemId);
    expect(fromDisk.content_revision).toBe(updated.content_revision);
    const raw = await readItemRawMarkdown(fs, path, itemId);
    expect(raw).toContain("https://cdn.example/x.png");

    const docStat = await fs.stat(itemMarkdownPath(path, itemId));
    if (docStat.mtimeMs === null) {
      throw new Error(`missing mtime for ${itemId}`);
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
        itemId,
        contentRevision: updated.content_revision,
      }),
    );
    expect(job).not.toBeNull();
    expect(job!.type).toBe(itemDerivedRefreshJobType.id);
    expect(job!.status).toBe("pending");
    expect(JSON.parse(job!.payload_json)).toEqual({
      vaultId: meta.id,
      vaultPath: path,
      itemId,
      contentRevision: updated.content_revision,
      fileMtimeMs: docStat.mtimeMs,
      itemUrl: null,
    });
  });
});
