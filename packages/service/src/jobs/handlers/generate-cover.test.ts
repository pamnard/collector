import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCoverJobType } from "@collector/shared";

const applyItemCover = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    applyItemCover: (...args: unknown[]) => applyItemCover(...args),
  };
});

import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  createGenerateCoverHandler,
  enqueueGenerateCover,
} from "./generate-cover.js";

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
  itemId: "note.md",
  mediaId: "m1",
  absolutePath: "/vault/note.media/a.png",
  filename: "a.png",
  mediaType: "image" as const,
};

describe("generateCover job (#636 / #640)", () => {
  const dirs: string[] = [];
  const queues: JobQueue[] = [];
  const readBinary = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const resolveVaultPath = vi.fn(async () => "/vault");
  const generateCoverFromMedia = vi.fn(
    async () => new Uint8Array([9, 9, 9]),
  );
  const onVaultPresentationChanged = vi.fn();

  beforeEach(() => {
    applyItemCover.mockReset();
    applyItemCover.mockResolvedValue(undefined);
    readBinary.mockClear();
    resolveVaultPath.mockClear();
    generateCoverFromMedia.mockReset();
    generateCoverFromMedia.mockResolvedValue(new Uint8Array([9, 9, 9]));
    onVaultPresentationChanged.mockClear();
  });

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function handler() {
    return createGenerateCoverHandler({
      getContext: () => ({ fs: { readBinary } }) as never,
      resolveVaultPath,
      generateCoverFromMedia,
      onVaultPresentationChanged,
    });
  }

  it("writes the generated cover and succeeds", async () => {
    await expect(
      handler()({
        id: "job-1",
        type: "generateCover",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(resolveVaultPath).toHaveBeenCalledWith("vault-1");
    expect(readBinary).toHaveBeenCalledWith("/vault/note.media/a.png");
    expect(generateCoverFromMedia).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "a.png",
      "image",
    );
    expect(applyItemCover).toHaveBeenCalledWith(
      expect.objectContaining({ fs: { readBinary } }),
      "/vault",
      "vault-1",
      "note.md",
      new Uint8Array([9, 9, 9]),
    );
    expect(onVaultPresentationChanged).toHaveBeenCalledWith("vault-1");
  });

  it("returns retryable fail when cover generation yields null", async () => {
    generateCoverFromMedia.mockResolvedValueOnce(null);

    await expect(
      handler()({
        id: "job-1",
        type: "generateCover",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({
      status: "fail",
      retryable: true,
      error: "generateCover returned null",
    });
    expect(applyItemCover).not.toHaveBeenCalled();
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });

  it("coalesces repeated cover jobs for the same media", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-generate-cover-job-"));
    dirs.push(dir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    generateCoverFromMedia.mockImplementation(async () => {
      await gate;
      return new Uint8Array([9]);
    });
    const registry = createJobRegistry([generateCoverJobType]);
    registry.register(generateCoverJobType, handler());
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    queue.start();

    const first = await enqueueGenerateCover(queue, samplePayload);
    await waitFor(async () => (await queue.stats()).running === 1);
    const second = await enqueueGenerateCover(queue, samplePayload);

    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    expect(generateCoverFromMedia).toHaveBeenCalledTimes(1);

    release();
    await waitFor(async () => (await queue.stats()).succeeded === 1);
  });
});
