/**
 * itemDerivedRefresh enqueue with failure reporting — real jobs.db (#886).
 * Mocking enqueueItemDerivedRefresh would stay green if the handler enqueue broke.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  itemDerivedRefreshIdempotencyKey,
  itemDerivedRefreshJobType,
} from "@collector/shared";
import { createJobPermanentFailureStore } from "../../job-permanent-failure.js";
import { createJobQueue, type JobQueue } from "../../jobs/job-queue.js";
import { createJobRegistry } from "../../jobs/job-registry.js";
import { enqueueItemDerivedRefreshWithFailureReporting } from "./item-derived-refresh-enqueue.js";

describe("enqueueItemDerivedRefreshWithFailureReporting (#776 / #886)", () => {
  let dataDir = "";
  const queues: JobQueue[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openQueue(): Promise<JobQueue> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-derived-enqueue-"));
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(itemDerivedRefreshJobType, async () => ({
      status: "ok",
    }));
    const queue = await createJobQueue({
      dbPath: join(dataDir, "jobs.db"),
      registry,
    });
    queues.push(queue);
    return queue;
  }

  const payload = {
    vaultId: "v1",
    vaultPath: "/vault",
    itemId: "n.md",
    contentRevision: 1,
    fileMtimeMs: 100,
  };

  it("enqueues itemDerivedRefresh into jobs.db with shared idempotency key", async () => {
    const queue = await openQueue();
    const store = createJobPermanentFailureStore();

    await enqueueItemDerivedRefreshWithFailureReporting(
      {
        requireJobs: () => queue,
        jobPermanentFailure: store,
      },
      payload,
    );

    const stats = await queue.stats();
    expect(stats.pending).toBe(1);
    expect(stats.byType.itemDerivedRefresh).toMatchObject({
      pending: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
    });

    const job = await queue.findByIdempotencyKey(
      itemDerivedRefreshIdempotencyKey(payload),
    );
    expect(job).not.toBeNull();
    expect(job!.type).toBe(itemDerivedRefreshJobType.id);
    expect(job!.status).toBe("pending");
    expect(JSON.parse(job!.payload_json)).toEqual(payload);
  });

  it("surfaces enqueue failure via permanent-failure contract", async () => {
    const store = createJobPermanentFailureStore();
    const seen: Array<{ type: string; error: string; attempts: number }> = [];
    store.subscribe((payload) => {
      seen.push({
        type: payload.type,
        error: payload.error,
        attempts: payload.attempts,
      });
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await enqueueItemDerivedRefreshWithFailureReporting(
      {
        requireJobs: () => {
          throw new Error("queue full");
        },
        jobPermanentFailure: store,
      },
      payload,
    );

    expect(seen).toEqual([
      {
        type: "itemDerivedRefresh",
        error: "enqueue failed: queue full",
        attempts: 0,
      },
    ]);
    errorSpy.mockRestore();
  });
});
