import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  readItemFile,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  upsertItem,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import {
  itemExtractAutoIdempotencyKey,
  itemExtractAutoJobType,
} from "@collector/shared";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";
import { enqueueItemExtractAuto } from "./jobs/handlers/item-extract-auto.js";
import { createJobQueue, type JobQueue } from "./jobs/job-queue.js";
import { createJobRegistry } from "./jobs/job-registry.js";

describe("createItemsCrud extract auto enqueue", () => {
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

  async function setupVaultAndCrud() {
    dataDir = await mkdtemp(
      join(tmpdir(), "collector-extract-auto-enqueue-"),
    );
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });

    const registry = createJobRegistry([itemExtractAutoJobType]);
    registry.register(itemExtractAutoJobType, async () => ({
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
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async (input) => {
          await enqueueItemExtractAuto(queue, input);
        },
      } as never,
      () => crypto.randomUUID(),
    );

    return { ctx, crud, meta, path, queue };
  }

  async function seedNote(
    ctx: { fs: NodeFileSystemAdapter; index: SqlVaultIndexStore },
    path: string,
    vaultId: string,
    body: string,
  ) {
    const folderPath = await resolveOrCreateInboxFolder(ctx, path);
    const itemId = `${folderPath}/${crypto.randomUUID()}.md`;
    const timestamp = new Date().toISOString();
    const created = await upsertItem(ctx, path, vaultId, {
      item: {
        id: itemId,
        vault_id: vaultId,
        title: "n",
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
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: body,
    });
    return created;
  }

  it("updateItemSource body change writes vault item and enqueues itemExtractAuto in jobs.db", async () => {
    const { ctx, crud, meta, path, queue } = await setupVaultAndCrud();
    const seeded = await seedNote(ctx, path, meta.id, "old\n");

    const newBody =
      "https://www.instagram.com/p/NewCode/\n";
    const existingRaw = await readItemRawMarkdown(fs, path, seeded.id);
    const updatedRaw = existingRaw.replace("old\n", newBody);
    expect(updatedRaw).not.toBe(existingRaw);

    const updated = await crud.updateItemSource(seeded.id, updatedRaw);

    const fromDisk = await readItemFile(fs, path, updated.id, meta.id);
    expect(fromDisk.id).toBe(updated.id);
    const raw = await readItemRawMarkdown(fs, path, updated.id);
    expect(raw).toContain("https://www.instagram.com/p/NewCode/");
    expect(raw).not.toContain("old\n");

    const stats = await queue.stats();
    expect(stats.pending).toBe(1);
    expect(stats.byType.itemExtractAuto).toMatchObject({
      pending: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
    });

    const job = await queue.findByIdempotencyKey(
      itemExtractAutoIdempotencyKey({
        vaultId: meta.id,
        itemId: updated.id,
        contentRevision: updated.content_revision,
      }),
    );
    expect(job).not.toBeNull();
    expect(job!.type).toBe(itemExtractAutoJobType.id);
    expect(job!.status).toBe("pending");
    expect(JSON.parse(job!.payload_json)).toEqual({
      vaultId: meta.id,
      vaultPath: path,
      itemId: updated.id,
      contentRevision: updated.content_revision,
    });
  });

  it("metadata-only updateItem writes disk and does not enqueue itemExtractAuto", async () => {
    const { ctx, crud, meta, path, queue } = await setupVaultAndCrud();
    const seeded = await seedNote(ctx, path, meta.id, "body\n");

    const updated = await crud.updateItem(seeded.id, {
      metadata: {
        custom_flag: true,
      },
    });

    const fromDisk = await readItemFile(fs, path, updated.id, meta.id);
    expect(fromDisk.metadata).toMatchObject({
      custom_flag: true,
    });
    const raw = await readItemRawMarkdown(fs, path, updated.id);
    expect(raw).toContain("body");

    const stats = await queue.stats();
    expect(stats.pending).toBe(0);
    expect(stats.byType.itemExtractAuto).toBeUndefined();

    const job = await queue.findByIdempotencyKey(
      itemExtractAutoIdempotencyKey({
        vaultId: meta.id,
        itemId: updated.id,
        contentRevision: updated.content_revision,
      }),
    );
    expect(job).toBeNull();
  });
});
