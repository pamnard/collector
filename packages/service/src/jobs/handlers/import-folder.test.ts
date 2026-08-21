import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importFolderJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createImportFolderHandler,
  enqueueImportFolder,
  peekImportFolderResult,
  takeImportFolderResult,
} from "./import-folder.js";

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

describe("importFolder job (#747)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];
  const createItem = vi.fn();
  const attachMediaFiles = vi.fn();
  const updateItemSource = vi.fn();
  const findItemIdByUrl = vi.fn();

  beforeEach(() => {
    createItem.mockReset();
    attachMediaFiles.mockReset();
    updateItemSource.mockReset();
    findItemIdByUrl.mockReset();
    findItemIdByUrl.mockResolvedValue(null);
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

  it("imports md notes, skips non-importable files, and stores mailbox result", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "collector-import-folder-"));
    dirs.push(sourceDir);
    writeFileSync(
      join(sourceDir, "one.md"),
      "---\ntitle: One\n---\nbody one\n",
    );
    writeFileSync(
      join(sourceDir, "two.md"),
      "---\ntitle: Two\n---\nbody two\n",
    );
    writeFileSync(join(sourceDir, "ignore.txt"), "not a note\n");

    const handler = createImportFolderHandler({
      createItem,
      attachMediaFiles,
      updateItemSource,
      findItemIdByUrl,
    });
    const result = await handler({
      id: "job-folder-1",
      type: "importFolder",
      attempts: 0,
      payload: {
        vaultId: "vault-1",
        sourceDirAbs: sourceDir,
      },
    });

    expect(result).toEqual({ status: "ok" });
    expect(createItem).toHaveBeenCalledTimes(2);
    expect(takeImportFolderResult("job-folder-1")).toEqual({
      createdIds: ["Inbox/One.md", "Inbox/Two.md"],
      skippedIds: [],
      failures: [],
      created: 2,
      skipped: 0,
      failed: 0,
    });
  });

  it("skips notes whose canonical url already exists", async () => {
    const sourceDir = mkdtempSync(
      join(tmpdir(), "collector-import-folder-skip-"),
    );
    dirs.push(sourceDir);
    writeFileSync(
      join(sourceDir, "again.md"),
      "---\ntitle: Again\nurl: https://example.com/note\n---\nbody\n",
    );
    findItemIdByUrl.mockResolvedValue("Inbox/Existing.md");

    const handler = createImportFolderHandler({
      createItem,
      attachMediaFiles,
      updateItemSource,
      findItemIdByUrl,
    });
    await handler({
      id: "job-folder-skip",
      type: "importFolder",
      attempts: 0,
      payload: {
        vaultId: "vault-1",
        sourceDirAbs: sourceDir,
      },
    });

    expect(createItem).not.toHaveBeenCalled();
    expect(findItemIdByUrl).toHaveBeenCalledWith(
      "vault-1",
      "https://example.com/note",
    );
    expect(takeImportFolderResult("job-folder-skip")).toEqual({
      createdIds: [],
      skippedIds: ["Inbox/Existing.md"],
      failures: [],
      created: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it("enqueues and returns an id without waiting for the full tree", async () => {
    const sourceDir = mkdtempSync(
      join(tmpdir(), "collector-import-folder-queue-"),
    );
    dirs.push(sourceDir);
    const nested = join(sourceDir, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "a.md"), "---\ntitle: A\n---\n\n");

    let releaseImport: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    createItem.mockImplementation(async (input: { title: string }) => {
      await gate;
      return {
        id: `Inbox/${input.title}.md`,
        folder_path: "Inbox",
        title: input.title,
      };
    });

    const registry = createJobRegistry([importFolderJobType]);
    registry.register(
      importFolderJobType,
      createImportFolderHandler({
        createItem,
        attachMediaFiles,
        updateItemSource,
        findItemIdByUrl,
      }),
    );
    const queue = await createJobQueue({
      dbPath: join(sourceDir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const { id, deduped } = await enqueueImportFolder(queue, {
      vaultId: "vault-1",
      sourceDirAbs: sourceDir,
    });
    expect(deduped).toBe(false);
    expect(id).toMatch(/\S/);
    expect(peekImportFolderResult(id)).toBeNull();

    releaseImport?.();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(takeImportFolderResult(id)).toEqual({
      createdIds: ["Inbox/A.md"],
      skippedIds: [],
      failures: [],
      created: 1,
      skipped: 0,
      failed: 0,
    });
  });
});
