import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropImportBatchJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createDropImportBatchHandler,
  enqueueDropImportBatch,
  takeDropImportResult,
} from "./drop-import-batch.js";

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

describe("dropImportBatch job (#637 / #640)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];
  const createItem = vi.fn();
  const attachMediaFiles = vi.fn();
  const updateItemSource = vi.fn();

  beforeEach(() => {
    createItem.mockReset();
    attachMediaFiles.mockReset();
    updateItemSource.mockReset();
    createItem.mockImplementation(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      folder_path: "Inbox",
      title: input.title,
    }));
    attachMediaFiles.mockResolvedValue([]);
    updateItemSource.mockImplementation(async (id: string) => ({ id }));
  });

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads staging files, imports, and stores the mailbox result", async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), "collector-drop-import-job-"));
    dirs.push(stagingDir);
    const absPath = join(stagingDir, "shot.png");
    writeFileSync(absPath, Buffer.from([1, 2, 3]));

    const handler = createDropImportBatchHandler({
      createItem,
      attachMediaFiles,
      updateItemSource,
    });
    const result = await handler({
      id: "job-1",
      type: "dropImportBatch",
      attempts: 0,
      payload: {
        vaultId: "vault-1",
        stagingDir,
        paths: [absPath],
      },
    });

    expect(result).toEqual({ status: "ok" });
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "shot",
        content_type: "image",
        source_type: "import",
      }),
    );
    expect(attachMediaFiles).toHaveBeenCalledWith("Inbox/shot.md", [
      { name: "shot.png", bytes: expect.any(Uint8Array) },
    ]);
    expect(takeDropImportResult("job-1")).toEqual({
      createdIds: ["Inbox/shot.md"],
    });
  });

  it("runs through the queue and succeeds", async () => {
    const stagingDir = mkdtempSync(
      join(tmpdir(), "collector-drop-import-queue-"),
    );
    dirs.push(stagingDir);
    const absPath = join(stagingDir, "shot.png");
    writeFileSync(absPath, Buffer.from([1, 2, 3]));

    const registry = createJobRegistry([dropImportBatchJobType]);
    registry.register(
      dropImportBatchJobType,
      createDropImportBatchHandler({
        createItem,
        attachMediaFiles,
        updateItemSource,
      }),
    );
    const queue = await createJobQueue({
      dbPath: join(stagingDir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const { id, deduped } = await enqueueDropImportBatch(queue, {
      vaultId: "vault-1",
      stagingDir,
      paths: [absPath],
    });
    expect(deduped).toBe(false);
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(takeDropImportResult(id)).toEqual({
      createdIds: ["Inbox/shot.md"],
    });
  });
});
