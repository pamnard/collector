import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importFolderJobType } from "@collector/shared";
import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  ImportFolderFatalError,
  createImportFolderHandler,
  enqueueImportFolder,
  isFatalImportFolderError,
  peekImportFolderResult,
  takeImportFolderResult,
} from "./import-folder.js";
import { createDropImportRuntime } from "../../host/domain-runtime/drop-import.js";

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
  const assertActiveVault = vi.fn();

  beforeEach(() => {
    createItem.mockReset();
    attachMediaFiles.mockReset();
    updateItemSource.mockReset();
    findItemIdByUrl.mockReset();
    assertActiveVault.mockReset();
    findItemIdByUrl.mockResolvedValue(null);
    assertActiveVault.mockResolvedValue(undefined);
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

  function handler() {
    return createImportFolderHandler({
      createItem,
      attachMediaFiles,
      updateItemSource,
      findItemIdByUrl,
      assertActiveVault,
    });
  }

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

    const result = await handler()({
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
    expect(assertActiveVault).toHaveBeenCalledWith("vault-1");
    expect(takeImportFolderResult("job-folder-1")).toEqual({
      createdIds: ["Inbox/One.md", "Inbox/Two.md"],
      skippedIds: [],
      failures: [],
      created: 2,
      skipped: 0,
      failed: 0,
      status: "ok",
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

    await handler()({
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
      status: "ok",
    });
  });

  it("reports failed count beyond the failure sample cap", async () => {
    const sourceDir = mkdtempSync(
      join(tmpdir(), "collector-import-folder-cap-"),
    );
    dirs.push(sourceDir);
    for (let i = 0; i < 25; i += 1) {
      writeFileSync(
        join(sourceDir, `fail-${i}.md`),
        `---\ntitle: Fail${i}\n---\nbody\n`,
      );
    }
    createItem.mockRejectedValue(new Error("import rejected"));

    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handler()({
        id: "job-folder-cap",
        type: "importFolder",
        attempts: 0,
        payload: {
          vaultId: "vault-1",
          sourceDirAbs: sourceDir,
        },
      });
    } finally {
      logSpy.mockRestore();
    }

    const mailbox = takeImportFolderResult("job-folder-cap");
    expect(mailbox).not.toBeNull();
    expect(mailbox!.failed).toBe(25);
    expect(mailbox!.failures).toHaveLength(20);
    expect(mailbox!.status).toBe("failed");
    expect(mailbox!.created).toBe(0);
  });

  it("rejects relative and non-directory source paths as non-retryable fail", async () => {
    const relative = await handler()({
      id: "job-rel",
      type: "importFolder",
      attempts: 0,
      payload: {
        vaultId: "vault-1",
        sourceDirAbs: "relative/notes",
      },
    });
    expect(relative).toEqual({
      status: "fail",
      retryable: false,
      error: expect.stringMatching(/must be absolute/),
    });

    const filePath = join(
      mkdtempSync(join(tmpdir(), "collector-import-folder-file-")),
      "note.md",
    );
    dirs.push(join(filePath, ".."));
    writeFileSync(filePath, "---\ntitle: X\n---\n");

    const notDir = await handler()({
      id: "job-file",
      type: "importFolder",
      attempts: 0,
      payload: {
        vaultId: "vault-1",
        sourceDirAbs: filePath,
      },
    });
    expect(notDir).toEqual({
      status: "fail",
      retryable: false,
      error: expect.stringMatching(/not a directory/),
    });
  });

  it("aborts on vault mismatch as non-retryable fail (no retry burn)", async () => {
    const sourceDir = mkdtempSync(
      join(tmpdir(), "collector-import-folder-vault-"),
    );
    dirs.push(sourceDir);
    writeFileSync(
      join(sourceDir, "one.md"),
      "---\ntitle: One\n---\nbody\n",
    );
    assertActiveVault.mockRejectedValue(
      new ImportFolderFatalError(
        "active_vault_mismatch",
        "active vault mismatch for job: vault-1",
      ),
    );

    const result = await handler()({
      id: "job-vault-mismatch",
      type: "importFolder",
      attempts: 0,
      payload: {
        vaultId: "vault-1",
        sourceDirAbs: sourceDir,
      },
    });
    expect(result).toEqual({
      status: "fail",
      retryable: false,
      error: expect.stringMatching(/active vault mismatch/),
    });
    expect(createItem).not.toHaveBeenCalled();
    expect(takeImportFolderResult("job-vault-mismatch")).toBeNull();
  });

  it("counts unreadable files as failed and continues the job", async () => {
    const sourceDir = mkdtempSync(
      join(tmpdir(), "collector-import-folder-io-"),
    );
    dirs.push(sourceDir);
    const badPath = join(sourceDir, "bad.md");
    writeFileSync(badPath, "---\ntitle: Bad\n---\n");
    chmodSync(badPath, 0);
    writeFileSync(
      join(sourceDir, "good.md"),
      "---\ntitle: Good\n---\nbody\n",
    );

    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await handler()({
        id: "job-folder-io",
        type: "importFolder",
        attempts: 0,
        payload: {
          vaultId: "vault-1",
          sourceDirAbs: sourceDir,
        },
      });
      expect(result).toEqual({ status: "ok" });
    } finally {
      chmodSync(badPath, 0o644);
      logSpy.mockRestore();
    }

    expect(createItem).toHaveBeenCalledTimes(1);
    const mailbox = takeImportFolderResult("job-folder-io");
    expect(mailbox).toMatchObject({
      created: 1,
      failed: 1,
      status: "partial",
    });
    expect(mailbox!.failures[0]?.relativePath).toBe("bad.md");
  });

  it("returns non-retryable fail when import hits typed fatal mid-job", async () => {
    const sourceDir = mkdtempSync(
      join(tmpdir(), "collector-import-folder-fatal-mid-"),
    );
    dirs.push(sourceDir);
    writeFileSync(
      join(sourceDir, "one.md"),
      "---\ntitle: One\n---\nbody\n",
    );
    createItem.mockRejectedValue(
      new ImportFolderFatalError("index_unavailable", "index is unavailable"),
    );

    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await handler()({
        id: "job-folder-fatal-mid",
        type: "importFolder",
        attempts: 0,
        payload: {
          vaultId: "vault-1",
          sourceDirAbs: sourceDir,
        },
      });
      expect(result).toEqual({
        status: "fail",
        retryable: false,
        error: "index is unavailable",
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(takeImportFolderResult("job-folder-fatal-mid")).toMatchObject({
      created: 0,
      failed: 0,
      status: "failed",
    });
  });

  it("classifies vault/index errors as fatal via typed code or known signals", () => {
    expect(
      isFatalImportFolderError(
        new ImportFolderFatalError(
          "active_vault_mismatch",
          "active vault mismatch",
        ),
      ),
    ).toBe(true);
    expect(isFatalImportFolderError(new Error("SQLITE_BUSY: database"))).toBe(
      true,
    );
    expect(isFatalImportFolderError(new Error("import rejected"))).toBe(false);
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
        assertActiveVault,
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
    const enqueued = await queue.getJob(id);
    expect(enqueued?.max_attempts).toBe(1);

    releaseImport?.();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
    expect(takeImportFolderResult(id)).toEqual({
      createdIds: ["Inbox/A.md"],
      skippedIds: [],
      failures: [],
      created: 1,
      skipped: 0,
      failed: 0,
      status: "ok",
    });
  });

  it("getImportFolderJob peek stays stable across repeated polls", async () => {
    const sourceDir = mkdtempSync(
      join(tmpdir(), "collector-import-folder-peek-"),
    );
    dirs.push(sourceDir);
    writeFileSync(join(sourceDir, "a.md"), "---\ntitle: A\n---\n\n");

    const registry = createJobRegistry([importFolderJobType]);
    registry.register(
      importFolderJobType,
      createImportFolderHandler({
        createItem,
        attachMediaFiles,
        updateItemSource,
        findItemIdByUrl,
        assertActiveVault,
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

    const runtime = createDropImportRuntime({
      dataDir: sourceDir,
      resolveActiveVault: async () => ({ vault: { id: "vault-1" } }),
      requireJobs: () => queue,
    });

    const { jobId } = await runtime.importFolder({ sourceDirAbs: sourceDir });
    await waitFor(async () => (await queue.stats()).succeeded === 1);

    const first = await runtime.getImportFolderJob(jobId);
    const second = await runtime.getImportFolderJob(jobId);
    expect(first.status).toBe("succeeded");
    expect(first.result).toEqual({
      createdIds: ["Inbox/A.md"],
      skippedIds: [],
      failures: [],
      created: 1,
      skipped: 0,
      failed: 0,
      status: "ok",
    });
    expect(second.result).toEqual(first.result);
    expect(peekImportFolderResult(jobId)).toEqual(first.result);
  });
});
