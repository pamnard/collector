import { beforeEach, describe, expect, it, vi } from "vitest";

const listItemMediaWithPaths = vi.fn();
const attachMediaFile = vi.fn();
const replaceMediaFile = vi.fn();
const deleteMediaFile = vi.fn();
const clearItemCover = vi.fn();
const readItemFile = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    listItemMediaWithPaths: (...args: unknown[]) =>
      listItemMediaWithPaths(...args),
    attachMediaFile: (...args: unknown[]) => attachMediaFile(...args),
    replaceMediaFile: (...args: unknown[]) => replaceMediaFile(...args),
    deleteMediaFile: (...args: unknown[]) => deleteMediaFile(...args),
    clearItemCover: (...args: unknown[]) => clearItemCover(...args),
    readItemFile: (...args: unknown[]) => readItemFile(...args),
  };
});

import { createMediaCoverService } from "./media-cover.js";

describe("createMediaCoverService", () => {
  const vault = {
    id: "v1",
    name: "Vault",
    is_default: true,
    created_at: "a",
    updated_at: "a",
  };
  const readBinary = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const ctx = { fs: { readBinary } } as never;
  const enqueueGenerateCover = vi.fn(async () => ({ id: "job-1" }));
  const waitForCoverJob = vi.fn(async () => "succeeded" as const);
  const resolveThumbnailPathsBatch = vi.fn(
    async (_vaultPath: string, items: Array<{ id: string }>) =>
      items.map((item) => ({ id: item.id, path: `/thumb/${item.id}` })),
  );

  beforeEach(() => {
    listItemMediaWithPaths.mockReset();
    attachMediaFile.mockReset();
    replaceMediaFile.mockReset();
    deleteMediaFile.mockReset();
    clearItemCover.mockReset();
    readItemFile.mockReset();
    readBinary.mockClear();
    enqueueGenerateCover.mockClear();
    waitForCoverJob.mockClear();
    resolveThumbnailPathsBatch.mockClear();
    enqueueGenerateCover.mockResolvedValue({ id: "job-1" });
    waitForCoverJob.mockResolvedValue("succeeded");
  });

  function createService() {
    return createMediaCoverService({
      resolveActiveVault: async () => ({ vault: vault as never, path: "/vault" }),
      getContext: () => ctx,
      enqueueGenerateCover,
      waitForCoverJob,
      resolveThumbnailPathsBatch,
    });
  }

  it("listItemMedia delegates to core", async () => {
    listItemMediaWithPaths.mockResolvedValue([{ id: "m1" }]);
    const result = await createService().listItemMedia("note.md");
    expect(listItemMediaWithPaths).toHaveBeenCalledWith(ctx, "/vault", "note.md");
    expect(result).toEqual([{ id: "m1" }]);
  });

  it("resolveItemThumbnailPaths caches by thumbnail+updated_at", async () => {
    const service = createService();
    const item = {
      id: "note.md",
      thumbnail: "cover.webp",
      updated_at: "t1",
    } as never;

    const first = await service.resolveItemThumbnailPaths([item]);
    const second = await service.resolveItemThumbnailPaths([item]);

    expect(first.get("note.md")).toBe("/thumb/note.md");
    expect(second.get("note.md")).toBe("/thumb/note.md");
    expect(resolveThumbnailPathsBatch).toHaveBeenCalledTimes(1);
  });

  it("attachMediaFiles enqueues the preferred current cover candidate", async () => {
    attachMediaFile.mockResolvedValue({ id: "m1", filename: "a.png" });
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "a.png",
        absolute_path: "/vault/note.media/a.png",
      },
    ]);
    const result = await createService().attachMediaFiles("note.md", [
      { name: "a.png", bytes: new Uint8Array([1]) },
    ]);

    expect(attachMediaFile).toHaveBeenCalled();
    expect(enqueueGenerateCover).toHaveBeenCalledWith({
      vaultId: "v1",
      itemId: "note.md",
      mediaId: "m1",
      absolutePath: "/vault/note.media/a.png",
      filename: "a.png",
      mediaType: "image",
    });
    expect(result).toEqual([{ id: "m1", filename: "a.png" }]);
  });

  it("attachMediaFiles prefers an existing image over an attached video", async () => {
    attachMediaFile.mockResolvedValue({ id: "m1", filename: "clip.mp4" });
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "existing-image",
        media_type: "image",
        filename: "photo.png",
        absolute_path: "/vault/note.media/photo.png",
      },
      {
        id: "m1",
        media_type: "video",
        filename: "clip.mp4",
        absolute_path: "/vault/note.media/clip.mp4",
      },
    ]);
    const result = await createService().attachMediaFiles("note.md", [
      { name: "clip.mp4", bytes: new Uint8Array([1]) },
    ]);

    expect(enqueueGenerateCover).toHaveBeenCalledWith({
      vaultId: "v1",
      itemId: "note.md",
      mediaId: "existing-image",
      absolutePath: "/vault/note.media/photo.png",
      filename: "photo.png",
      mediaType: "image",
    });
    expect(readBinary).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: "m1", filename: "clip.mp4" }]);
  });

  it("setItemCoverFromMedia enqueues generateCover and re-reads item (#639)", async () => {
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "a.png",
        absolute_path: "/vault/note.media/a.png",
      },
    ]);
    const item = { id: "note.md", title: "Note" };
    readItemFile.mockResolvedValue(item);

    const result = await createService().setItemCoverFromMedia("note.md", "m1");

    expect(enqueueGenerateCover).toHaveBeenCalledWith({
      vaultId: "v1",
      itemId: "note.md",
      mediaId: "m1",
      absolutePath: "/vault/note.media/a.png",
      filename: "a.png",
      mediaType: "image",
    });
    expect(waitForCoverJob).toHaveBeenCalledWith("job-1");
    expect(readBinary).not.toHaveBeenCalled();
    expect(readItemFile).toHaveBeenCalledWith(ctx.fs, "/vault", "note.md", "v1");
    expect(result).toEqual(item);
  });

  it("setItemCoverFromMedia throws when cover job fails (#639)", async () => {
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "a.png",
        absolute_path: "/vault/note.media/a.png",
      },
    ]);
    waitForCoverJob.mockResolvedValueOnce("failed");

    await expect(
      createService().setItemCoverFromMedia("note.md", "m1"),
    ).rejects.toThrow(/generateCover job-1 finished as failed/);
    expect(readItemFile).not.toHaveBeenCalled();
  });

  it("setItemCoverFromMedia rejects missing media", async () => {
    listItemMediaWithPaths.mockResolvedValue([]);
    await expect(
      createService().setItemCoverFromMedia("note.md", "missing"),
    ).rejects.toThrow(/Media not found/);
  });

  it("replaceItemMedia enqueues cover generation after replacing", async () => {
    replaceMediaFile.mockResolvedValue({ id: "m1", filename: "b.png" });
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "b.png",
        absolute_path: "/vault/note.media/b.png",
      },
    ]);
    const result = await createService().replaceItemMedia("note.md", "m1", {
      name: "b.png",
      bytes: new Uint8Array([2]),
    });

    expect(replaceMediaFile).toHaveBeenCalledWith(
      ctx,
      "/vault",
      "note.md",
      "m1",
      { filename: "b.png", data: new Uint8Array([2]) },
    );
    expect(enqueueGenerateCover).toHaveBeenCalledWith({
      vaultId: "v1",
      itemId: "note.md",
      mediaId: "m1",
      absolutePath: "/vault/note.media/b.png",
      filename: "b.png",
      mediaType: "image",
    });
    expect(result).toEqual({ id: "m1", filename: "b.png" });
  });
});
