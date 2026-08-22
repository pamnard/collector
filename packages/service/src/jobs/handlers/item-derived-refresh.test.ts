import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itemDerivedRefreshJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createItemDerivedRefreshHandler,
  enqueueItemDerivedRefresh,
} from "./item-derived-refresh.js";

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

const samplePayload = {
  vaultId: "vault-1",
  vaultPath: "/tmp/vault",
  itemId: "Inbox/note.md",
  contentRevision: 3,
};

describe("itemDerivedRefresh job (#766)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upserts from vault bytes via core helper", async () => {
    const upsert = vi.fn(async () => "upserted" as const);
    const spy = vi
      .spyOn(await import("@collector/core"), "upsertItemIndexFromVault")
      .mockImplementation(upsert);
    const handler = createItemDerivedRefreshHandler({
      getContext: () =>
        ({
          fs: {},
          index: {},
        }) as never,
    });

    await expect(
      handler({
        id: "job-1",
        type: "itemDerivedRefresh",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(upsert).toHaveBeenCalledWith(
      expect.anything(),
      samplePayload.vaultPath,
      samplePayload.vaultId,
      samplePayload.itemId,
      samplePayload.contentRevision,
    );
    spy.mockRestore();
  });

  it("dedupes pending jobs for the same item revision", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-item-derived-job-"));
    dirs.push(dir);
    const upsert = vi.fn(async () => "upserted" as const);
    const spy = vi
      .spyOn(await import("@collector/core"), "upsertItemIndexFromVault")
      .mockImplementation(upsert);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createJobRegistry([itemDerivedRefreshJobType]);
    registry.register(
      itemDerivedRefreshJobType,
      async (job) => {
        await gate;
        return createItemDerivedRefreshHandler({
          getContext: () => ({ fs: {}, index: {} }) as never,
        })(job);
      },
    );
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueItemDerivedRefresh(queue, samplePayload);
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueItemDerivedRefresh(queue, samplePayload);

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    spy.mockRestore();
  });
});
