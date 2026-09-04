import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  applyItemCover,
  attachMediaFile,
  createVault,
  itemCoverPath,
  itemCoverSizePath,
  mediaFilePath,
  readItemFile,
  resolveItemThumbnailPathsProgressive,
  SqlVaultIndexStore,
  upsertItem,
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import type { GenerateCoverJobPayload, ItemFile, VaultMeta } from "@collector/shared";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { readCoverPixelSize } from "./cover-pixel-size.js";
import {
  createMediaCoverService,
  stubReadCoverPixelSizeUnavailable,
} from "./media-cover.js";

async function tinyPng(width = 64, height = 48): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    })
      .png()
      .toBuffer(),
  );
}

async function tinyWebp(width = 32, height = 24): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 90, g: 10, b: 30 },
      },
    })
      .webp()
      .toBuffer(),
  );
}

describe("createMediaCoverService", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openVault(): Promise<{
    ctx: VaultContext;
    vault: VaultMeta;
    vaultPath: string;
    itemId: string;
  }> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-cover-svc-"));
    const sql = new MemorySqlAdapter();
    const ctx: VaultContext = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta: vault, path: vaultPath } = await createVault(ctx, dataDir, {
      name: "Vault",
    });
    const itemId = `${crypto.randomUUID()}.md`;
    await upsertItem(ctx, vaultPath, vault.id, {
      item: {
        id: itemId,
        vault_id: vault.id,
        title: "Note",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    return { ctx, vault, vaultPath, itemId };
  }

  function createService(options: {
    ctx: VaultContext;
    vault: VaultMeta;
    vaultPath: string;
    enqueueGenerateCover?: (
      input: GenerateCoverJobPayload,
    ) => Promise<{ id: string }>;
    waitForCoverJob?: (
      jobId: string,
    ) => Promise<"succeeded" | "failed" | "cancelled">;
    cancelPendingGenerateCoversForItem?: (
      vaultId: string,
      itemId: string,
    ) => Promise<number>;
    resolveThumbnailPathsProgressive?: typeof resolveItemThumbnailPathsProgressive;
    readCoverPixelSize?: typeof readCoverPixelSize;
    onVaultPresentationChanged?: ReturnType<typeof vi.fn>;
  }) {
    const enqueued: GenerateCoverJobPayload[] = [];
    const cancelledFor: Array<{ vaultId: string; itemId: string }> = [];
    const enqueueGenerateCover =
      options.enqueueGenerateCover ??
      (async (input: GenerateCoverJobPayload) => {
        enqueued.push(input);
        return { id: `job-${enqueued.length}` };
      });
    const cancelPendingGenerateCoversForItem =
      options.cancelPendingGenerateCoversForItem ??
      (async (vaultId: string, itemId: string) => {
        cancelledFor.push({ vaultId, itemId });
        return 0;
      });

    const service = createMediaCoverService({
      resolveActiveVault: async () => ({
        vault: options.vault,
        path: options.vaultPath,
      }),
      getContext: () => options.ctx,
      enqueueGenerateCover,
      waitForCoverJob:
        options.waitForCoverJob ?? (async () => "succeeded" as const),
      cancelPendingGenerateCoversForItem,
      resolveThumbnailPathsProgressive:
        options.resolveThumbnailPathsProgressive ??
        resolveItemThumbnailPathsProgressive.bind(null, options.ctx.fs),
      readCoverPixelSize: options.readCoverPixelSize ?? readCoverPixelSize,
      onVaultPresentationChanged: options.onVaultPresentationChanged,
    });

    return { service, enqueued, cancelledFor };
  }

  it("listItemMedia returns media files that exist on disk", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service } = createService({ ctx, vault, vaultPath });
    const png = await tinyPng();

    const attached = await service.attachMediaFiles(itemId, [
      { name: "shot.png", bytes: png },
    ]);
    expect(attached).toHaveLength(1);

    const listed = await service.listItemMedia(itemId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.filename).toBe("shot.png");
    expect(listed[0]!.media_type).toBe("image");
    expect(await fs.exists(listed[0]!.absolute_path)).toBe(true);
    expect(await fs.readBinary(listed[0]!.absolute_path)).toEqual(png);
  });

  it("attachMediaFiles writes media, bumps updated_at, and enqueues that image path", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const before = await readItemFile(fs, vaultPath, itemId, vault.id);
    const onVaultPresentationChanged = vi.fn();
    const { service, enqueued } = createService({
      ctx,
      vault,
      vaultPath,
      onVaultPresentationChanged,
    });
    const png = await tinyPng();

    const attached = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: png },
    ]);

    const after = await readItemFile(fs, vaultPath, itemId, vault.id);
    expect(after.updated_at > before.updated_at).toBe(true);
    expect(attached[0]!.filename).toBe("a.png");

    const listed = await service.listItemMedia(itemId);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual({
      vaultId: vault.id,
      itemId,
      mediaId: listed[0]!.id,
      absolutePath: listed[0]!.absolute_path,
      filename: "a.png",
      mediaType: "image",
    });
    expect(await fs.exists(enqueued[0]!.absolutePath)).toBe(true);
    // Cover job not done yet — do not emit itemCoverChanged (#856).
    expect(onVaultPresentationChanged).not.toHaveBeenCalled();
  });

  it("preferred cover enqueue cancels pending covers for the item (#875)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service, cancelledFor } = createService({ ctx, vault, vaultPath });
    await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: await tinyPng() },
    ]);
    expect(cancelledFor).toEqual([{ vaultId: vault.id, itemId }]);
  });

  it("setItemCoverFromMedia cancels pending covers before enqueue (#875)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service, cancelledFor } = createService({
      ctx,
      vault,
      vaultPath,
      waitForCoverJob: async () => "succeeded",
    });
    const [media] = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: await tinyPng() },
    ]);
    cancelledFor.length = 0;

    await service.setItemCoverFromMedia(itemId, media!.id);

    expect(cancelledFor).toEqual([{ vaultId: vault.id, itemId }]);
  });

  it("serialized presentation failure does not raise unhandledRejection (#875)", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const { ctx, vault, vaultPath, itemId } = await openVault();
      const { service } = createService({
        ctx,
        vault,
        vaultPath,
        enqueueGenerateCover: async () => {
          throw new Error("enqueue boom");
        },
      });
      await expect(
        service.attachMediaFiles(itemId, [
          { name: "a.png", bytes: await tinyPng() },
        ]),
      ).rejects.toThrow(/enqueue boom/);
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("attachMediaFiles prefers an existing image over an attached video", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service, enqueued } = createService({ ctx, vault, vaultPath });
    const png = await tinyPng();

    await service.attachMediaFiles(itemId, [{ name: "photo.png", bytes: png }]);
    enqueued.length = 0;

    await service.attachMediaFiles(itemId, [
      { name: "clip.mp4", bytes: new Uint8Array([0, 1, 2, 3]) },
    ]);

    const listed = await service.listItemMedia(itemId);
    const image = listed.find((m) => m.media_type === "image");
    expect(image).toBeDefined();
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.mediaId).toBe(image!.id);
    expect(enqueued[0]!.filename).toBe("photo.png");
    expect(enqueued[0]!.mediaType).toBe("image");
    expect(await fs.exists(enqueued[0]!.absolutePath)).toBe(true);
  });

  it("deleteItemMedia clears cover files when no media remains and emits itemCoverChanged (#856)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const onVaultPresentationChanged = vi.fn();
    const { service, cancelledFor } = createService({
      ctx,
      vault,
      vaultPath,
      onVaultPresentationChanged,
    });
    const png = await tinyPng();
    const [media] = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: png },
    ]);

    const coverBytes = await tinyWebp(40, 30);
    await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
      width: 40,
      height: 30,
    });
    expect(await fs.exists(itemCoverPath(vaultPath, itemId))).toBe(true);
    expect(await fs.exists(itemCoverSizePath(vaultPath, itemId))).toBe(true);

    await service.deleteItemMedia(itemId, media!.id);

    expect(await service.listItemMedia(itemId)).toHaveLength(0);
    expect(await fs.exists(itemCoverPath(vaultPath, itemId))).toBe(false);
    expect(await fs.exists(itemCoverSizePath(vaultPath, itemId))).toBe(false);
    expect(cancelledFor).toContainEqual({ vaultId: vault.id, itemId });
    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId: vault.id,
      kind: "itemCoverChanged",
      itemId,
      folderPath: "",
    });
  });

  it("serializes concurrent preferred-cover enqueues for one item (#875)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service, enqueued } = createService({ ctx, vault, vaultPath });
    const [first, second, third] = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: await tinyPng(32, 32) },
      { name: "b.png", bytes: await tinyPng(40, 40) },
      { name: "c.png", bytes: await tinyPng(48, 48) },
    ]);
    enqueued.length = 0;

    await Promise.all([
      service.deleteItemMedia(itemId, first!.id),
      service.deleteItemMedia(itemId, second!.id),
    ]);

    expect(enqueued.length).toBeGreaterThanOrEqual(1);
    const remaining = await service.listItemMedia(itemId);
    expect(remaining.map((m) => m.id)).toEqual([third!.id]);
    expect(enqueued.at(-1)!.mediaId).toBe(third!.id);
  });

  it("replaceItemMedia overwrites bytes on disk and enqueues that media", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service, enqueued } = createService({ ctx, vault, vaultPath });
    const first = await tinyPng(32, 32);
    const second = await tinyPng(48, 48);
    const [media] = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: first },
    ]);
    enqueued.length = 0;

    const replaced = await service.replaceItemMedia(itemId, media!.id, {
      name: "b.png",
      bytes: second,
    });

    expect(replaced.filename).toBe("b.png");
    const listed = await service.listItemMedia(itemId);
    expect(listed).toHaveLength(1);
    expect(await fs.readBinary(listed[0]!.absolute_path)).toEqual(second);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.mediaId).toBe(listed[0]!.id);
    expect(enqueued[0]!.absolutePath).toBe(listed[0]!.absolute_path);
    expect(enqueued[0]!.filename).toBe("b.png");
  });

  it("setItemCoverFromMedia waits for job, writes cover.webp + size, returns item (#639)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    let lastJob: GenerateCoverJobPayload | undefined;
    const coverBytes = await tinyWebp(36, 28);
    const coverSize = { width: 36, height: 28 };

    const { service } = createService({
      ctx,
      vault,
      vaultPath,
      enqueueGenerateCover: async (input) => {
        lastJob = input;
        return { id: "job-cover-1" };
      },
      waitForCoverJob: async (jobId) => {
        expect(jobId).toBe("job-cover-1");
        expect(lastJob).toBeDefined();
        await applyItemCover(
          ctx,
          vaultPath,
          vault.id,
          lastJob!.itemId,
          coverBytes,
          coverSize,
          { sourceMediaId: lastJob!.mediaId },
        );
        return "succeeded";
      },
    });

    const png = await tinyPng();
    const [media] = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: png },
    ]);

    const result = await service.setItemCoverFromMedia(itemId, media!.id);

    expect(result.id).toBe(itemId);
    expect(await fs.exists(itemCoverPath(vaultPath, itemId))).toBe(true);
    expect(await fs.readBinary(itemCoverPath(vaultPath, itemId))).toEqual(
      coverBytes,
    );
    expect(
      JSON.parse(await fs.readText(itemCoverSizePath(vaultPath, itemId))),
    ).toEqual(coverSize);
    expect(lastJob).toMatchObject({
      vaultId: vault.id,
      itemId,
      mediaId: media!.id,
      filename: "a.png",
      mediaType: "image",
    });
    expect(await fs.exists(lastJob!.absolutePath)).toBe(true);
  });

  it("setItemCoverFromMedia throws when cover job fails and leaves no cover (#639)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service } = createService({
      ctx,
      vault,
      vaultPath,
      waitForCoverJob: async () => "failed",
    });
    const [media] = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: await tinyPng() },
    ]);

    await expect(
      service.setItemCoverFromMedia(itemId, media!.id),
    ).rejects.toThrow(/generateCover .+ finished as failed/);
    expect(await fs.exists(itemCoverPath(vaultPath, itemId))).toBe(false);
  });

  it("setItemCoverFromMedia rejects missing media", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const { service } = createService({ ctx, vault, vaultPath });

    await expect(
      service.setItemCoverFromMedia(itemId, "missing-media-id"),
    ).rejects.toThrow(/Media not found/);
  });

  it("resolveItemThumbnailEntries reads cover.size.json without sharp backfill (#822)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const coverBytes = await tinyWebp(64, 48);
    await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
      width: 64,
      height: 48,
    });
    const item = await readItemFile(fs, vaultPath, itemId, vault.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readSharp = vi.fn(readCoverPixelSize);
    const { service } = createService({
      ctx,
      vault,
      vaultPath,
      readCoverPixelSize: readSharp,
    });

    const entries = await service.resolveItemThumbnailEntries([item]);

    expect(entries.get(itemId)).toEqual({
      path: itemCoverPath(vaultPath, itemId),
      size: { width: 64, height: 48 },
    });
    expect(readSharp).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolveItemThumbnailEntries returns cover-source path for display (#879)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const source = await attachMediaFile(ctx, vaultPath, itemId, {
      filename: "full.png",
      data: await tinyPng(800, 600),
    });
    const coverBytes = await tinyWebp(64, 48);
    await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
      width: 64,
      height: 48,
    }, { sourceMediaId: source.id, sourceFilename: source.filename });
    const item = await readItemFile(fs, vaultPath, itemId, vault.id);
    const { service } = createService({ ctx, vault, vaultPath });

    const entries = await service.resolveItemThumbnailEntries([item]);

    expect(entries.get(itemId)).toEqual({
      path: mediaFilePath(vaultPath, itemId, source.id, source.filename),
      size: { width: 64, height: 48 },
    });
  });

  it("resolveItemThumbnailEntries backfills missing cover.size.json via sharp (#822)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const coverBytes = await tinyWebp(50, 40);
    await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
      width: 50,
      height: 40,
    });
    await fs.remove(itemCoverSizePath(vaultPath, itemId));
    expect(await fs.exists(itemCoverSizePath(vaultPath, itemId))).toBe(false);

    const item = await readItemFile(fs, vaultPath, itemId, vault.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service } = createService({ ctx, vault, vaultPath });

    const entries = await service.resolveItemThumbnailEntries([item]);

    expect(entries.get(itemId)?.path).toBe(itemCoverPath(vaultPath, itemId));
    expect(entries.get(itemId)?.size).toEqual({ width: 50, height: 40 });
    expect(
      JSON.parse(await fs.readText(itemCoverSizePath(vaultPath, itemId))),
    ).toEqual({ width: 50, height: 40 });
    expect(warn).toHaveBeenCalledWith(
      "[media-cover] cover size sidecar missing; backfilling via sharp.metadata",
      {
        itemId,
        absoluteCoverPath: itemCoverPath(vaultPath, itemId),
      },
    );
    warn.mockRestore();
  });

  it("resolveItemThumbnailPaths caches by thumbnail+updated_at", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const coverBytes = await tinyWebp();
    await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
      width: 32,
      height: 24,
    });
    const item = await readItemFile(fs, vaultPath, itemId, vault.id);

    let progressiveCalls = 0;
    const { service } = createService({
      ctx,
      vault,
      vaultPath,
      resolveThumbnailPathsProgressive: async (vp, items, options) => {
        progressiveCalls += 1;
        await resolveItemThumbnailPathsProgressive(fs, vp, items, options);
      },
    });

    const first = await service.resolveItemThumbnailPaths([item]);
    const second = await service.resolveItemThumbnailPaths([item]);

    expect(first.get(itemId)).toBe(itemCoverPath(vaultPath, itemId));
    expect(second.get(itemId)).toBe(itemCoverPath(vaultPath, itemId));
    expect(progressiveCalls).toBe(1);
  });

  it("invalidateThumbnailPathCache drops a sticky null so re-resolve can see cover (#856)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const stale = await readItemFile(fs, vaultPath, itemId, vault.id);
    const { service } = createService({ ctx, vault, vaultPath });

    const first = await service.resolveItemThumbnailPaths([stale]);
    expect(first.get(itemId)).toBeNull();

    const coverBytes = await tinyWebp();
    await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
      width: 32,
      height: 24,
    });

    // Same cache key as `stale` → would stick on null without invalidate.
    const stillStale: ItemFile = { ...stale };
    const cached = await service.resolveItemThumbnailPaths([stillStale]);
    expect(cached.get(itemId)).toBeNull();

    service.invalidateThumbnailPathCache(itemId);
    const second = await service.resolveItemThumbnailPaths([stillStale]);
    expect(second.get(itemId)).toBe(itemCoverPath(vaultPath, itemId));
  });

  it("attach invalidates stale null thumbnail cache after updated_at bump (#720)", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const before = await readItemFile(fs, vaultPath, itemId, vault.id);
    const { service } = createService({ ctx, vault, vaultPath });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await service.resolveItemThumbnailPaths([before]);
    expect(first.get(itemId)).toBeNull();

    await service.attachMediaFiles(itemId, [
      { name: "shot.png", bytes: await tinyPng() },
    ]);
    const after = await readItemFile(fs, vaultPath, itemId, vault.id);
    expect(after.updated_at > before.updated_at).toBe(true);

    const second = await service.resolveItemThumbnailPaths([after]);
    const listed = await service.listItemMedia(itemId);
    expect(second.get(itemId)).toBe(listed[0]!.absolute_path);
    expect(await fs.exists(second.get(itemId)!)).toBe(true);
    warn.mockRestore();
  });

  it("cold resolve with unavailable stub fails instead of null-filled size", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const coverBytes = await tinyWebp();
    await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
      width: 32,
      height: 24,
    });
    await fs.remove(itemCoverSizePath(vaultPath, itemId));
    const item = await readItemFile(fs, vaultPath, itemId, vault.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { service } = createService({
      ctx,
      vault,
      vaultPath,
      readCoverPixelSize: stubReadCoverPixelSizeUnavailable,
    });

    await expect(service.resolveItemThumbnailEntries([item])).rejects.toThrow(
      /readCoverPixelSize unavailable outside Node host/,
    );
    warn.mockRestore();
  });
  it("starts size read for a fast id before the last path resolve finishes (#823)", async () => {
    const { ctx, vault, vaultPath } = await openVault();
    const slowId = `${crypto.randomUUID()}.md`;
    const fastId = `${crypto.randomUUID()}.md`;
    for (const id of [slowId, fastId]) {
      await upsertItem(ctx, vaultPath, vault.id, {
        item: {
          id,
          vault_id: vault.id,
          title: id,
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "",
          content_revision: 1,
          word_count: 0,
          character_count: 0,
          created_at: new Date().toISOString(),
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      });
      await applyItemCover(
        ctx,
        vaultPath,
        vault.id,
        id,
        await tinyWebp(16, 16),
        { width: 16, height: 16 },
      );
      await fs.remove(itemCoverSizePath(vaultPath, id));
    }

    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let slowStarted = false;
    const sizeStartedFor: string[] = [];

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service } = createService({
      ctx,
      vault,
      vaultPath,
      resolveThumbnailPathsProgressive: async (_vp, items, options) => {
        await Promise.all(
          items.map(async (item) => {
            if (item.id === slowId) {
              slowStarted = true;
              await slowGate;
            }
            options.onResolved({
              id: item.id,
              path: itemCoverPath(vaultPath, item.id),
            });
          }),
        );
      },
      readCoverPixelSize: async (absolutePath) => {
        const id =
          absolutePath === itemCoverPath(vaultPath, fastId) ? fastId : slowId;
        sizeStartedFor.push(id);
        if (id === fastId) {
          expect(slowStarted).toBe(true);
          releaseSlow?.();
        }
        return readCoverPixelSize(absolutePath);
      },
    });

    const entries = await service.resolveItemThumbnailEntries([
      {
        id: slowId,
        thumbnail: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      } as ItemFile,
      {
        id: fastId,
        thumbnail: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      } as ItemFile,
    ]);

    expect(sizeStartedFor[0]).toBe(fastId);
    expect(entries.get(fastId)?.size).toEqual({ width: 16, height: 16 });
    expect(entries.get(slowId)?.size).toEqual({ width: 16, height: 16 });
    expect(
      JSON.parse(await fs.readText(itemCoverSizePath(vaultPath, fastId))),
    ).toEqual({ width: 16, height: 16 });
    warn.mockRestore();
  });

  it("setItemCoverFromMedia emits itemCoverChanged after successful apply", async () => {
    const { ctx, vault, vaultPath, itemId } = await openVault();
    const onVaultPresentationChanged = vi.fn();
    const coverBytes = await tinyWebp();
    const { service } = createService({
      ctx,
      vault,
      vaultPath,
      onVaultPresentationChanged,
      enqueueGenerateCover: async (input) => ({ id: `job-${input.mediaId}` }),
      waitForCoverJob: async () => {
        await applyItemCover(ctx, vaultPath, vault.id, itemId, coverBytes, {
          width: 32,
          height: 24,
        });
        return "succeeded";
      },
    });
    const [media] = await service.attachMediaFiles(itemId, [
      { name: "a.png", bytes: await tinyPng() },
    ]);
    onVaultPresentationChanged.mockClear();

    await service.setItemCoverFromMedia(itemId, media!.id);

    expect(onVaultPresentationChanged).toHaveBeenCalledWith({
      vaultId: vault.id,
      kind: "itemCoverChanged",
      itemId,
      folderPath: "",
    });
    expect(await fs.exists(itemCoverPath(vaultPath, itemId))).toBe(true);
  });
});
