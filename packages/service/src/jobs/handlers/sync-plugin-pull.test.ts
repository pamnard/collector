import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncPluginPullJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createSyncPluginPullHandler,
  enqueueSyncPluginPull,
} from "./sync-plugin-pull.js";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
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

describe("createSyncPluginPullHandler (#634)", () => {
  it("runs the requested plugin cycle", async () => {
    const syncNow = vi.fn(async () => ({
      importedCount: 1,
      itemIds: ["Inbox/A.md"],
    }));
    const handler = createSyncPluginPullHandler({ syncNow });

    const result = await handler({
      id: "job-1",
      type: "syncPluginPull",
      payload: { pluginId: "telegram" },
      attempts: 1,
    });

    expect(syncNow).toHaveBeenCalledOnce();
    expect(syncNow).toHaveBeenCalledWith("telegram");
    expect(result).toEqual({ status: "ok" });
  });

  it("lets pull failures reach the job runner", async () => {
    const error = new Error("pull exploded");
    const handler = createSyncPluginPullHandler({
      syncNow: vi.fn(async () => {
        throw error;
      }),
    });

    await expect(
      handler({
        id: "job-1",
        type: "syncPluginPull",
        payload: { pluginId: "telegram" },
        attempts: 1,
      }),
    ).rejects.toBe(error);
  });
});

describe("enqueueSyncPluginPull (#634 / #640)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("coalesces repeated pulls for the same plugin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-sync-plugin-job-"));
    dirs.push(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncNow = vi.fn(async () => {
      await gate;
      return { importedCount: 0, itemIds: [] };
    });
    const registry = createJobRegistry([syncPluginPullJobType]);
    registry.register(
      syncPluginPullJobType,
      createSyncPluginPullHandler({ syncNow }),
    );
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueSyncPluginPull(queue, { pluginId: "telegram" });
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueSyncPluginPull(queue, { pluginId: "telegram" });

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    expect(syncNow).toHaveBeenCalledTimes(1);

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
  });
});
