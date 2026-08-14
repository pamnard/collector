import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reindexVaultBatchJobType } from "@collector/shared";

const reconcileIndexFolderPrefixFromFilesystem = vi.fn();
const syncIndexItemsFromFilesystem = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    reconcileIndexFolderPrefixFromFilesystem: (...args: unknown[]) =>
      reconcileIndexFolderPrefixFromFilesystem(...args),
    syncIndexItemsFromFilesystem: (...args: unknown[]) =>
      syncIndexItemsFromFilesystem(...args),
  };
});

import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createReindexVaultBatchHandler,
  enqueueReindexVaultBatch,
} from "./reindex-vault-batch.js";

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
  vaultPath: "/vault",
  itemIds: ["note.md"],
  folderPaths: ["Inbox"],
};

describe("reindexVaultBatch job (#632 / #640)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];
  const onItemsSynced = vi.fn();
  const onWatchApplied = vi.fn();
  const ctx = { kind: "vault-ctx" };

  beforeEach(() => {
    reconcileIndexFolderPrefixFromFilesystem.mockReset();
    syncIndexItemsFromFilesystem.mockReset();
    reconcileIndexFolderPrefixFromFilesystem.mockResolvedValue({
      errors: [],
    });
    syncIndexItemsFromFilesystem.mockResolvedValue({ errors: [] });
    onItemsSynced.mockClear();
    onWatchApplied.mockClear();
  });

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function handler() {
    return createReindexVaultBatchHandler({
      getContext: () => ctx as never,
      onItemsSynced,
      onWatchApplied,
    });
  }

  it("reconciles folders then items and succeeds", async () => {
    await expect(
      handler()({
        id: "job-1",
        type: "reindexVaultBatch",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(reconcileIndexFolderPrefixFromFilesystem).toHaveBeenCalledWith(
      ctx,
      "/vault",
      "vault-1",
      "Inbox",
    );
    expect(syncIndexItemsFromFilesystem).toHaveBeenCalledWith(
      ctx,
      "/vault",
      "vault-1",
      ["note.md"],
    );
    expect(onItemsSynced).toHaveBeenCalledWith("vault-1");
    expect(onWatchApplied).toHaveBeenCalledWith("vault-1", "/vault");
  });

  it("returns retryable fail when folder prefix sync reports errors", async () => {
    reconcileIndexFolderPrefixFromFilesystem.mockResolvedValueOnce({
      errors: [{ message: "folder boom" }],
    });

    await expect(
      handler()({
        id: "job-1",
        type: "reindexVaultBatch",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({
      status: "fail",
      retryable: true,
      error: "folder prefix index sync failed: folder boom",
    });
    expect(syncIndexItemsFromFilesystem).not.toHaveBeenCalled();
    expect(onItemsSynced).not.toHaveBeenCalled();
  });

  it("coalesces repeated batches with the same digest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-reindex-batch-job-"));
    dirs.push(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    syncIndexItemsFromFilesystem.mockImplementation(async () => {
      await gate;
      return { errors: [] };
    });
    const registry = createJobRegistry([reindexVaultBatchJobType]);
    registry.register(reindexVaultBatchJobType, handler());
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueReindexVaultBatch(queue, samplePayload);
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueReindexVaultBatch(queue, samplePayload);

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    expect(syncIndexItemsFromFilesystem).toHaveBeenCalledTimes(1);

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
  });
});
