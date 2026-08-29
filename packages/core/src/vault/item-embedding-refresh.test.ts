import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  refreshEmbeddingsJobPayloadSchema,
  refreshEmbeddingsJobType,
  type ItemFile,
} from "@collector/shared";
import { runJobsMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import type {
  ItemEmbeddingRefreshInput,
  VaultContext,
} from "../adapters/types.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId, nowIso } from "../util/ids.js";
import { ensureTagsByName } from "./item-io.js";
import {
  embeddingRefreshInputFromItem,
  flushEmbeddingRefresh,
  refreshItemEmbeddingAfterWrite,
  tagNamesForItem,
} from "./item-embedding-refresh.js";
import { createVault } from "./vault-operations.js";

type JobRow = {
  type: string;
  payload_json: string;
  status: string;
  idempotency_key: string | null;
};

/**
 * Production-shaped enqueue port: durable jobs row with the same type,
 * payload schema, and idempotency digest as service enqueueRefreshEmbeddings.
 */
function createJobsEnqueuePort(jobsDb: BetterSqliteMigrator): {
  enqueue(vaultId: string, inputs: ItemEmbeddingRefreshInput[]): Promise<void>;
} {
  return {
    async enqueue(vaultId, inputs) {
      const payload = refreshEmbeddingsJobPayloadSchema.parse({
        vaultId,
        inputs,
      });
      const digest = createHash("sha256")
        .update(
          payload.inputs
            .map((input) => `${input.itemId}:${input.contentRevision}`)
            .sort()
            .join("\0"),
        )
        .digest("hex")
        .slice(0, 16);
      const now = nowIso();
      await jobsDb.execute(
        `INSERT INTO jobs (
          id, type, payload_json, status, priority, idempotency_key,
          attempts, max_attempts, available_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', 0, ?, 0, 3, ?, ?, ?)`,
        [
          createId(),
          refreshEmbeddingsJobType.id,
          JSON.stringify(payload),
          `refreshEmbeddings:${payload.vaultId}:${digest}`,
          now,
          now,
          now,
        ],
      );
    },
  };
}

async function listJobs(jobsDb: BetterSqliteMigrator): Promise<JobRow[]> {
  return jobsDb.select<JobRow>(
    `SELECT type, payload_json, status, idempotency_key FROM jobs ORDER BY created_at`,
  );
}

function sampleItem(
  vaultId: string,
  itemId: string,
  overrides: Partial<ItemFile> = {},
): ItemFile {
  const ts = nowIso();
  return {
    id: itemId,
    vault_id: vaultId,
    title: "Garden roses",
    description: "shared topic",
    url: null,
    content_type: "note",
    source_type: "manual",
    source_id: null,
    metadata: {},
    properties: {},
    thumbnail: null,
    tag_ids: [],
    collection_ids: [],
    folder_path: "",
    content_revision: 3,
    word_count: 0,
    character_count: 0,
    created_at: ts,
    updated_at: ts,
    ...overrides,
  };
}

describe("item embedding refresh (#639)", () => {
  let dataDir = "";
  let jobsDb: BetterSqliteMigrator | null = null;
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    jobsDb?.close();
    jobsDb = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openJobsDb(): Promise<BetterSqliteMigrator> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-emb-refresh-"));
    jobsDb = BetterSqliteMigrator.open(join(dataDir, "jobs.db"));
    await runJobsMigrations(jobsDb);
    return jobsDb;
  }

  it("refreshItemEmbeddingAfterWrite schedules refreshEmbeddings job with vault tag names and body", async () => {
    const sql = await openJobsDb();
    const vaultPath = join(dataDir, "vault");
    const index = new SqlVaultIndexStore(new MemorySqlAdapter());
    const enqueuePort = createJobsEnqueuePort(sql);
    const ctx: VaultContext = {
      fs,
      index,
      embeddingRefreshJobs: enqueuePort,
    };
    const { meta } = await createVault(ctx, vaultPath, { name: "Vault" });

    const tags = await ensureTagsByName(fs, vaultPath, ["plants", "design"]);
    const itemId = `${createId()}.md`;
    const item = sampleItem(meta.id, itemId, {
      tag_ids: [tags.byName.get("plants")!.id, tags.byName.get("design")!.id],
      title: "Garden roses",
      description: "shared topic",
      content_revision: 3,
    });

    await refreshItemEmbeddingAfterWrite(
      ctx,
      vaultPath,
      meta.id,
      item,
      "rose petals in spring",
    );

    const rows = await listJobs(sql);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("refreshEmbeddings");
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.idempotency_key).toBe(
      `refreshEmbeddings:${meta.id}:${createHash("sha256")
        .update(`${itemId}:3`)
        .digest("hex")
        .slice(0, 16)}`,
    );

    const payload = refreshEmbeddingsJobPayloadSchema.parse(
      JSON.parse(rows[0]!.payload_json),
    );
    expect(payload.vaultId).toBe(meta.id);
    expect(payload.inputs).toEqual([
      {
        itemId,
        title: "Garden roses",
        description: "shared topic",
        tagNames: ["plants", "design"],
        body: "rose petals in spring",
        contentRevision: 3,
      },
    ]);
  });

  it("flushEmbeddingRefresh writes one pending refreshEmbeddings row for the batch", async () => {
    const sql = await openJobsDb();
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
      embeddingRefreshJobs: createJobsEnqueuePort(sql),
    } satisfies VaultContext;

    const inputs: ItemEmbeddingRefreshInput[] = [
      {
        itemId: "a.md",
        title: "A",
        description: "da",
        tagNames: ["x"],
        contentRevision: 1,
      },
      {
        itemId: "b.md",
        title: "B",
        description: "db",
        tagNames: [],
        body: "body-b",
        contentRevision: 2,
      },
    ];

    await flushEmbeddingRefresh(ctx, "vault-1", inputs);

    const rows = await listJobs(sql);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe(refreshEmbeddingsJobType.id);
    const payload = refreshEmbeddingsJobPayloadSchema.parse(
      JSON.parse(rows[0]!.payload_json),
    );
    expect(payload).toEqual({ vaultId: "vault-1", inputs });
  });

  it("flushEmbeddingRefresh leaves jobs empty when inputs are empty", async () => {
    const sql = await openJobsDb();
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
      embeddingRefreshJobs: createJobsEnqueuePort(sql),
    } satisfies VaultContext;

    await flushEmbeddingRefresh(ctx, "vault-1", []);
    expect(await listJobs(sql)).toEqual([]);
  });

  it("refreshItemEmbeddingAfterWrite no-ops without jobs or embeddings ports", async () => {
    const sql = await openJobsDb();
    const vaultPath = join(dataDir, "vault-noop");
    const ctx: VaultContext = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
    };
    const { meta } = await createVault(ctx, vaultPath, { name: "Vault" });
    const item = sampleItem(meta.id, `${createId()}.md`);

    await refreshItemEmbeddingAfterWrite(ctx, vaultPath, meta.id, item, "x");
    expect(await listJobs(sql)).toEqual([]);
  });

  it("flushEmbeddingRefresh rejects embeddings without embeddingRefreshJobs", async () => {
    const refreshCalls: ItemEmbeddingRefreshInput[][] = [];
    const ctx = {
      fs,
      index: new SqlVaultIndexStore(new MemorySqlAdapter()),
      embeddings: {
        refresh: async (inputs: ItemEmbeddingRefreshInput[]) => {
          refreshCalls.push(inputs);
        },
      },
    } satisfies VaultContext;

    await expect(
      flushEmbeddingRefresh(ctx, "v1", [
        {
          itemId: "note.md",
          title: "t",
          description: "d",
          tagNames: [],
          contentRevision: 1,
        },
      ]),
    ).rejects.toThrow(/embedding refresh requires embeddingRefreshJobs/);
    expect(refreshCalls).toEqual([]);
  });

  it("tagNamesForItem and embeddingRefreshInputFromItem map disk tags and body", () => {
    const byId = new Map([
      ["tag-a", { name: "alpha" }],
      ["tag-b", { name: "beta" }],
    ]);
    const item = sampleItem("v1", "note.md", {
      tag_ids: ["tag-b", "missing", "tag-a"],
      title: "T",
      description: "D",
      content_revision: 9,
    });
    const tagNames = tagNamesForItem(item, byId);
    expect(tagNames).toEqual(["beta", "alpha"]);
    expect(embeddingRefreshInputFromItem(item, tagNames, "body text")).toEqual({
      itemId: "note.md",
      title: "T",
      description: "D",
      tagNames: ["beta", "alpha"],
      body: "body text",
      contentRevision: 9,
    });
    expect(embeddingRefreshInputFromItem(item, tagNames, null)).toEqual({
      itemId: "note.md",
      title: "T",
      description: "D",
      tagNames: ["beta", "alpha"],
      body: undefined,
      contentRevision: 9,
    });
  });
});
