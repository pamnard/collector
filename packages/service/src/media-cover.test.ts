import { beforeEach, describe, expect, it, vi } from "vitest";

const listItemMediaWithPaths = vi.fn();
const attachMediaFile = vi.fn();
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
      { filename: "a.png", data: new Uint8Array([1]) },
    ]);

    expect(attachMediaFile).toHaveBeenCalled();
    expect(generateCoverFromMedia).toHaveBeenCalled();
    expect(applyItemCover).toHaveBeenCalled();
    expect(result).toEqual([{ id: "m1", filename: "a.png" }]);
  });

  it("setItemCoverFromMedia rejects missing media", async () => {
    listItemMediaWithPaths.mockResolvedValue([]);
    await expect(
      createService().setItemCoverFromMedia("note.md", "missing"),
    ).rejects.toThrow(/Media not found/);
  });
});
