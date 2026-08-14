import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { vaultIndexSyncJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createVaultIndexSyncHandler,
  enqueueVaultIndexSync,
} from "./vault-index-sync.js";

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

describe("vaultIndexSync job (#631 / #638)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the existing vault index sync and succeeds", async () => {
    const startVaultIndexSync = vi.fn(async () => undefined);
    const handler = createVaultIndexSyncHandler({ startVaultIndexSync });

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
  });

  it("coalesces repeated kickoff jobs by vault id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-vault-index-job-"));
    dirs.push(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startVaultIndexSync = vi.fn(async () => gate);
    const registry = createJobRegistry([vaultIndexSyncJobType]);
    registry.register(
      vaultIndexSyncJobType,
      createVaultIndexSyncHandler({ startVaultIndexSync }),
    );
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueVaultIndexSync(queue, {
      vaultId: "vault-1",
      vaultPath: "/vault",
      reason: "kickoff",
    });
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueVaultIndexSync(queue, {
      vaultId: "vault-1",
      vaultPath: "/vault",
      reason: "kickoff",
    });

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    expect(startVaultIndexSync).toHaveBeenCalledTimes(1);

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
  });
});
