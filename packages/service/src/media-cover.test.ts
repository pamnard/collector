import { beforeEach, describe, expect, it, vi } from "vitest";

const listItemMediaWithPaths = vi.fn();
const attachMediaFile = vi.fn();
const replaceMediaFile = vi.fn();
const deleteMediaFile = vi.fn();
const applyItemCover = vi.fn();
const clearItemCover = vi.fn();

vi.mock("@collector/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@collector/core")>();
  return {
    ...actual,
    listItemMediaWithPaths: (...args: unknown[]) =>
      listItemMediaWithPaths(...args),
    attachMediaFile: (...args: unknown[]) => attachMediaFile(...args),
    replaceMediaFile: (...args: unknown[]) => replaceMediaFile(...args),
    deleteMediaFile: (...args: unknown[]) => deleteMediaFile(...args),
    applyItemCover: (...args: unknown[]) => applyItemCover(...args),
    clearItemCover: (...args: unknown[]) => clearItemCover(...args),
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
  const generateCoverFromMedia = vi.fn(async () => new Uint8Array([9]));
  const resolveThumbnailPathsBatch = vi.fn(
    async (_vaultPath: string, items: Array<{ id: string }>) =>
      items.map((item) => ({ id: item.id, path: `/thumb/${item.id}` })),
  );

  beforeEach(() => {
    listItemMediaWithPaths.mockReset();
    attachMediaFile.mockReset();
    replaceMediaFile.mockReset();
    deleteMediaFile.mockReset();
    applyItemCover.mockReset();
    clearItemCover.mockReset();
    readBinary.mockClear();
    generateCoverFromMedia.mockClear();
    resolveThumbnailPathsBatch.mockClear();
  });

  function createService() {
    return createMediaCoverService({
      resolveActiveVault: async () => ({ vault: vault as never, path: "/vault" }),
      getContext: () => ctx,
      generateCoverFromMedia,
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

  it("attachMediaFiles attaches then syncs cover from first image", async () => {
    attachMediaFile.mockResolvedValue({ id: "m1", filename: "a.png" });
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "a.png",
        absolute_path: "/vault/note.media/a.png",
      },
    ]);
    applyItemCover.mockResolvedValue({ id: "note.md" });

    const result = await createService().attachMediaFiles("note.md", [
      { name: "a.png", bytes: new Uint8Array([1]) },
    ]);

    expect(attachMediaFile).toHaveBeenCalled();
    expect(generateCoverFromMedia).toHaveBeenCalled();
    expect(applyItemCover).toHaveBeenCalled();
    expect(result).toEqual([{ id: "m1", filename: "a.png" }]);
  });

  it("attachMediaFiles syncs cover from video when no image (#435)", async () => {
    attachMediaFile.mockResolvedValue({ id: "m1", filename: "clip.mp4" });
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "video",
        filename: "clip.mp4",
        absolute_path: "/vault/note.media/clip.mp4",
      },
    ]);
    applyItemCover.mockResolvedValue({ id: "note.md" });

    const result = await createService().attachMediaFiles("note.md", [
      { name: "clip.mp4", bytes: new Uint8Array([1]) },
    ]);

    expect(generateCoverFromMedia).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "clip.mp4",
      "video",
    );
    expect(applyItemCover).toHaveBeenCalled();
    expect(clearItemCover).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: "m1", filename: "clip.mp4" }]);
  });

  it("attachMediaFiles throws when cover generate returns null (#437)", async () => {
    attachMediaFile.mockResolvedValue({ id: "m1", filename: "clip.mp4" });
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "video",
        filename: "clip.mp4",
        absolute_path: "/vault/note.media/clip.mp4",
      },
    ]);
    generateCoverFromMedia.mockResolvedValueOnce(null);

    await expect(
      createService().attachMediaFiles("note.md", [
        { name: "clip.mp4", bytes: new Uint8Array([1]) },
      ]),
    ).rejects.toThrow(/Failed to generate cover from media/);
    expect(clearItemCover).not.toHaveBeenCalled();
    expect(applyItemCover).not.toHaveBeenCalled();
  });

  it("setItemCoverFromMedia throws when cover generate returns null (#437)", async () => {
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "a.png",
        absolute_path: "/vault/note.media/a.png",
      },
    ]);
    generateCoverFromMedia.mockResolvedValueOnce(null);

    await expect(
      createService().setItemCoverFromMedia("note.md", "m1"),
    ).rejects.toThrow(/Failed to generate cover from media/);
    expect(clearItemCover).not.toHaveBeenCalled();
    expect(applyItemCover).not.toHaveBeenCalled();
  });

  it("setItemCoverFromMedia rejects missing media", async () => {
    listItemMediaWithPaths.mockResolvedValue([]);
    await expect(
      createService().setItemCoverFromMedia("note.md", "missing"),
    ).rejects.toThrow(/Media not found/);
  });

  it("replaceItemMedia replaces then syncs cover (#353)", async () => {
    replaceMediaFile.mockResolvedValue({ id: "m1", filename: "b.png" });
    listItemMediaWithPaths.mockResolvedValue([
      {
        id: "m1",
        media_type: "image",
        filename: "b.png",
        absolute_path: "/vault/note.media/b.png",
      },
    ]);
    applyItemCover.mockResolvedValue({ id: "note.md" });

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
    expect(generateCoverFromMedia).toHaveBeenCalled();
    expect(applyItemCover).toHaveBeenCalled();
    expect(result).toEqual({ id: "m1", filename: "b.png" });
  });
});
