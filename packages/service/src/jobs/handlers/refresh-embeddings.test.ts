import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshEmbeddingsJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createRefreshEmbeddingsHandler,
  enqueueRefreshEmbeddings,
} from "./refresh-embeddings.js";

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
  inputs: [
    {
      itemId: "note.md",
      title: "t",
      description: "d",
      tagNames: [] as string[],
      contentRevision: 1,
    },
  ],
};

describe("refreshEmbeddings job (#633 / #640)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refreshes the given inputs and succeeds", async () => {
    const refresh = vi.fn(async () => undefined);
    const handler = createRefreshEmbeddingsHandler({ refresh });

    await expect(
      handler({
        id: "job-1",
        type: "refreshEmbeddings",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(refresh).toHaveBeenCalledWith(samplePayload.inputs);
  });

  it("coalesces repeated batches with the same digest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-refresh-emb-job-"));
    dirs.push(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn(async () => gate);
    const registry = createJobRegistry([refreshEmbeddingsJobType]);
    registry.register(
      refreshEmbeddingsJobType,
      createRefreshEmbeddingsHandler({ refresh }),
    );
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueRefreshEmbeddings(queue, samplePayload);
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueRefreshEmbeddings(queue, samplePayload);

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    expect(refresh).toHaveBeenCalledTimes(1);

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
  });
});
