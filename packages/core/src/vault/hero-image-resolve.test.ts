import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { applyItemCover } from "./cover-operations.js";
import { resolveItemHeroMedia } from "./hero-image-resolve.js";
import { upsertItem } from "./item-operations.js";
import { mediaFilePath } from "./media-io.js";
import { attachMediaFile } from "./media-operations.js";
import { itemCoverPath } from "./paths.js";
import { createVault } from "./vault-operations.js";

describe("resolveItemHeroMedia", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedItem(title: string) {
    dataDir = await mkdtemp(join(tmpdir(), "collector-hero-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const itemId = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title,
        description: "",
        content_type: "image",
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
    return { ctx, path, vaultId: meta.id, itemId };
  }

  it("keeps cover identity but displays full cover-source media (not lex-min gallery)", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Both");
    await attachMediaFile(ctx, path, itemId, {
      filename: "a-first.png",
      data: new TextEncoder().encode("full-res-a"),
    });
    const coverMedia = await attachMediaFile(ctx, path, itemId, {
      filename: "z-cover-source.png",
      data: new TextEncoder().encode("full-res-z"),
    });
    await applyItemCover(
      ctx,
      path,
      vaultId,
      itemId,
      new TextEncoder().encode("fake-webp-from-z"),
      { width: 320, height: 240 },
      { sourceMediaId: coverMedia.id },
    );

    const resolved = await resolveItemHeroMedia(fs, path, itemId);

    expect(resolved).toEqual({
      kind: "image",
      filePath: itemCoverPath(path, itemId),
      displayPath: mediaFilePath(
        path,
        itemId,
        coverMedia.id,
        coverMedia.filename,
      ),
    });
  });

  it("falls back to cover.webp display when cover.source sidecar is missing (legacy)", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Legacy");
    await attachMediaFile(ctx, path, itemId, {
      filename: "a-first.png",
      data: new TextEncoder().encode("full-res-a"),
    });
    await attachMediaFile(ctx, path, itemId, {
      filename: "z-second.png",
      data: new TextEncoder().encode("full-res-z"),
    });
    await applyItemCover(
      ctx,
      path,
      vaultId,
      itemId,
      new TextEncoder().encode("fake-webp"),
      { width: 320, height: 240 },
    );

    const resolved = await resolveItemHeroMedia(fs, path, itemId);

    expect(resolved).toEqual({
      kind: "image",
      filePath: itemCoverPath(path, itemId),
      displayPath: itemCoverPath(path, itemId),
    });
  });

  it("legacy sole gallery image is used for display without cover.source", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Sole");
    const only = await attachMediaFile(ctx, path, itemId, {
      filename: "only.png",
      data: new TextEncoder().encode("full-res"),
    });
    await applyItemCover(
      ctx,
      path,
      vaultId,
      itemId,
      new TextEncoder().encode("fake-webp"),
      { width: 320, height: 240 },
    );

    const resolved = await resolveItemHeroMedia(fs, path, itemId);

    expect(resolved).toEqual({
      kind: "image",
      filePath: itemCoverPath(path, itemId),
      displayPath: mediaFilePath(path, itemId, only.id, only.filename),
    });
  });

  it("selects gallery video with cover as display poster when no gallery image", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Video");
    const video = await attachMediaFile(ctx, path, itemId, {
      filename: "demo.mp4",
      data: new TextEncoder().encode("video-bytes"),
      mediaType: "video",
    });
    await applyItemCover(
      ctx,
      path,
      vaultId,
      itemId,
      new TextEncoder().encode("fake-webp"),
      { width: 320, height: 240 },
      { sourceMediaId: video.id },
    );

    const resolved = await resolveItemHeroMedia(fs, path, itemId);

    expect(resolved).toEqual({
      kind: "video",
      filePath: mediaFilePath(path, itemId, video.id, video.filename),
      displayPath: itemCoverPath(path, itemId),
    });
  });

  it("returns cover-only as image when no gallery media", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Cover only");
    await applyItemCover(
      ctx,
      path,
      vaultId,
      itemId,
      new TextEncoder().encode("fake-webp"),
      { width: 320, height: 240 },
    );

    const resolved = await resolveItemHeroMedia(fs, path, itemId);

    expect(resolved).toEqual({
      kind: "image",
      filePath: itemCoverPath(path, itemId),
      displayPath: itemCoverPath(path, itemId),
    });
  });

  it("falls back to gallery image when cover is missing", async () => {
    const { ctx, path, itemId } = await seedItem("Gallery only");
    const image = await attachMediaFile(ctx, path, itemId, {
      filename: "shot.png",
      data: new TextEncoder().encode("full-res"),
    });

    const resolved = await resolveItemHeroMedia(fs, path, itemId);

    expect(resolved).toEqual({
      kind: "image",
      filePath: mediaFilePath(path, itemId, image.id, image.filename),
      displayPath: mediaFilePath(path, itemId, image.id, image.filename),
    });
  });

  it("returns null when empty", async () => {
    const { path, itemId } = await seedItem("Empty");
    expect(await resolveItemHeroMedia(fs, path, itemId)).toBeNull();
  });
});
