import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCoverJobType } from "@collector/shared";

const { applyItemCover, listItemMediaWithPaths } = vi.hoisted(() => ({
  applyItemCover: vi.fn(),
  listItemMediaWithPaths: vi.fn(async () => [
    {
      id: "m1",
      media_type: "image",
      filename: "a.png",
      absolute_path: "/vault/note.media/a.png",
    },
  ]),
}));

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    applyItemCover: (...args: unknown[]) => applyItemCover(...args),
    listItemMediaWithPaths: (...args: unknown[]) =>
      listItemMediaWithPaths(...args),
  };
});

import { createJobQueue, type JobQueue } from "../job-queue.js";
import { createJobRegistry } from "../job-registry.js";
import {
  cancelPendingGenerateCoversForItem,
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
    async () =>
      ({
        data: new Uint8Array([9, 9, 9]),
        size: { width: 320, height: 240 },
      }) as const,
  );
  const onVaultPresentationChanged = vi.fn();
  const invalidateThumbnailPathCache = vi.fn();

  beforeEach(() => {
    applyItemCover.mockReset();
    applyItemCover.mockResolvedValue(undefined);
    listItemMediaWithPaths.mockReset();
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "a.png",
        absolute_path: "/vault/note.media/a.png",
      },
    ]);
    readBinary.mockClear();
    readBinary.mockResolvedValue(new Uint8Array([1, 2, 3]));
    resolveVaultPath.mockClear();
    generateCoverFromMedia.mockReset();
    generateCoverFromMedia.mockResolvedValue({
      data: new Uint8Array([9, 9, 9]),
      size: { width: 320, height: 240 },
    });
    onVaultPresentationChanged.mockClear();
    invalidateThumbnailPathCache.mockClear();
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
      invalidateThumbnailPathCache,
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
    expect(listItemMediaWithPaths).toHaveBeenCalledWith(
      expect.objectContaining({ fs: { readBinary } }),
      "/vault",
      "note.md",
    );
    expect(applyItemCover).toHaveBeenCalledWith(
      expect.objectContaining({ fs: { readBinary } }),
      "/vault",
      "vault-1",
      "note.md",
      new Uint8Array([9, 9, 9]),
      { width: 320, height: 240 },
    );
    expect(invalidateThumbnailPathCache).toHaveBeenCalledWith("note.md");
    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId: "vault-1",
      kind: "itemCoverChanged",
      itemId: "note.md",
      folderPath: "",
    });
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
    expect(invalidateThumbnailPathCache).not.toHaveBeenCalled();
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });

  it("succeeds quietly when readBinary hits ENOENT for a deleted source (#875)", async () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    });
    readBinary.mockRejectedValueOnce(enoent);

    await expect(
      handler()({
        id: "job-stale",
        type: "generateCover",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({ status: "ok" });

    expect(readBinary).toHaveBeenCalledWith("/vault/note.media/a.png");
    expect(generateCoverFromMedia).not.toHaveBeenCalled();
    expect(applyItemCover).not.toHaveBeenCalled();
    expect(invalidateThumbnailPathCache).not.toHaveBeenCalled();
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });

  it("still fails when readBinary errors for a non-ENOENT reason", async () => {
    const eio = Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    readBinary.mockRejectedValueOnce(eio);

    await expect(
      handler()({
        id: "job-eio",
        type: "generateCover",
        attempts: 0,
        payload: samplePayload,
      }),
    ).rejects.toThrow(/EIO/);
    expect(applyItemCover).not.toHaveBeenCalled();
  });

  it("succeeds quietly when media was removed after read (#875)", async () => {
    listItemMediaWithPaths.mockResolvedValueOnce([]);

    await expect(
      handler()({
        id: "job-detached",
        type: "generateCover",
        attempts: 0,
        payload: samplePayload,
      }),
    ).resolves.toEqual({ status: "ok" });

    expect(generateCoverFromMedia).toHaveBeenCalled();
    expect(applyItemCover).not.toHaveBeenCalled();
    expect(invalidateThumbnailPathCache).not.toHaveBeenCalled();
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });

  it("does not cancel sibling pending covers on plain enqueue (#875)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-generate-cover-plain-"));
    dirs.push(dir);
    const registry = createJobRegistry([generateCoverJobType]);
    registry.register(generateCoverJobType, handler());
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);

    const first = await enqueueGenerateCover(queue, samplePayload);
    const second = await enqueueGenerateCover(queue, {
      ...samplePayload,
      mediaId: "m2",
      absolutePath: "/vault/note.media/b.png",
      filename: "b.png",
    });

    expect(await queue.getJob(first.id)).toMatchObject({ status: "pending" });
    expect(await queue.getJob(second.id)).toMatchObject({ status: "pending" });
    expect(await queue.stats()).toMatchObject({ pending: 2, cancelled: 0 });
  });

  it("cancels pending covers when supersede cancel runs before enqueue (#875)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collector-generate-cover-supersede-"));
    dirs.push(dir);
    const registry = createJobRegistry([generateCoverJobType]);
    registry.register(generateCoverJobType, handler());
    const queue = await createJobQueue({
      dbPath: join(dir, "jobs.db"),
      registry,
      concurrency: 1,
      pollIntervalMs: 20,
    });
    queues.push(queue);
    // Do not start — keep jobs pending so supersede cancel can win.

    const stale = await enqueueGenerateCover(queue, samplePayload);
    await cancelPendingGenerateCoversForItem(
      queue,
      samplePayload.vaultId,
      samplePayload.itemId,
    );
    const next = await enqueueGenerateCover(queue, {
      ...samplePayload,
      mediaId: "m2",
      absolutePath: "/vault/note.media/b.png",
      filename: "b.png",
    });

    expect(stale.deduped).toBe(false);
    expect(next.deduped).toBe(false);
    expect(next.id).not.toBe(stale.id);
    expect(await queue.getJob(stale.id)).toMatchObject({ status: "cancelled" });
    expect(await queue.getJob(next.id)).toMatchObject({ status: "pending" });
    expect(await queue.stats()).toMatchObject({ cancelled: 1, pending: 1 });
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
      return {
        data: new Uint8Array([9]),
        size: { width: 9, height: 9 },
      };
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
