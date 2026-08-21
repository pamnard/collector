import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropImportBatchJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../../jobs/job-queue.js";
import { createJobRegistry } from "../../jobs/job-registry.js";
import { createDropImportBatchHandler } from "../../jobs/handlers/drop-import-batch.js";
import { createDropImportRuntime } from "./drop-import.js";

/** Long enough that a premature `finally` rm would delete staging before readFile. */
const HANDLER_READ_DELAY_MS = 100;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listStagingChildren(dataDir: string): Promise<string[]> {
  const root = join(dataDir, "drop-import-staging");
  if (!existsSync(root)) {
    return [];
  }
  return readdir(root);
}

describe("createDropImportRuntime staging cleanup (#745)", () => {
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

  async function startQueue(
    dataDir: string,
    handler: ReturnType<typeof createDropImportBatchHandler>,
  ): Promise<JobQueue> {
    const registry = createJobRegistry([dropImportBatchJobType]);
    registry.register(dropImportBatchJobType, async (job) => {
      await delay(HANDLER_READ_DELAY_MS);
      return handler(job);
    });
    const queue = await createJobQueue({
      dbPath: join(dataDir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();
    return queue;
  }

  it("keeps staging until delayed readFile succeeds, then removes it", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-drop-runtime-"));
    dirs.push(dataDir);

    const handler = createDropImportBatchHandler({
      createItem,
      attachMediaFiles,
      updateItemSource,
    });
    const queue = await startQueue(dataDir, handler);
    const runtime = createDropImportRuntime({
      dataDir,
      resolveActiveVault: async () => ({ vault: { id: "vault-1" } }),
      requireJobs: () => queue,
    });

    const raw = "---\ntitle: Delayed Note\n---\n\nHi\n";
    const result = await runtime.importDroppedFiles({
      files: [
        {
          relativePath: "note.md",
          name: "note.md",
          bytes: new TextEncoder().encode(raw),
        },
      ],
    });

    expect(result.createdIds).toEqual(["Inbox/Delayed Note.md"]);
    expect(createItem).toHaveBeenCalled();
    expect(await listStagingChildren(dataDir)).toEqual([]);
  });

  it("cleans staging after job failure that occurs after a successful read", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-drop-runtime-fail-"));
    dirs.push(dataDir);

    let readSucceeded = false;
    const registry = createJobRegistry([dropImportBatchJobType]);
    registry.register(dropImportBatchJobType, async (job) => {
      await delay(HANDLER_READ_DELAY_MS);
      const absPath = job.payload.paths[0];
      if (absPath === undefined) {
        throw new Error("dropImportBatch payload missing paths[0]");
      }
      await readFile(absPath);
      readSucceeded = true;
      return {
        status: "fail",
        retryable: false,
        error: "forced import failure after read",
      };
    });
    const queue = await createJobQueue({
      dbPath: join(dataDir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const runtime = createDropImportRuntime({
      dataDir,
      resolveActiveVault: async () => ({ vault: { id: "vault-1" } }),
      requireJobs: () => queue,
    });

    await expect(
      runtime.importDroppedFiles({
        files: [
          {
            relativePath: "note.md",
            name: "note.md",
            bytes: new TextEncoder().encode("body\n"),
          },
        ],
      }),
    ).rejects.toThrow(/without result/);

    expect(readSucceeded).toBe(true);
    expect(await listStagingChildren(dataDir)).toEqual([]);
  });
});
