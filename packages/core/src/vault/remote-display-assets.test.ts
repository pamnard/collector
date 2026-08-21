import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { createVault } from "./vault-operations.js";
import { upsertItem } from "./item-operations.js";
import { itemCoverPath } from "./paths.js";
import { listMediaFiles } from "./media-io.js";
import {
  extractMarkdownRemoteImageRefs,
  localizeRemoteDisplayAssets,
  rewriteMarkdownRemoteImageUrls,
} from "./remote-display-assets.js";
import { youtubeTeaserDownloadUrl } from "./youtube-video-id.js";
import { readItemRawMarkdown } from "./item-io.js";
import { serializeDocumentMarkdown } from "./frontmatter.js";

describe("remote display asset helpers (#739)", () => {
  it("extracts remote markdown images and skips code", () => {
    const body = [
      "Intro",
      "",
      "![a](https://cdn.example/a.png)",
      "",
      "```",
      "![skip](https://cdn.example/skip.png)",
      "```",
      "",
      "![b](http://cdn.example/b.jpg \"title\")",
      "",
      "![local](/vault/media/x/y.png)",
    ].join("\n");
    expect(extractMarkdownRemoteImageRefs(body).map((r) => r.rawUrl)).toEqual([
      "https://cdn.example/a.png",
      "http://cdn.example/b.jpg",
    ]);
  });

  it("rewrites remote image destinations to local paths", () => {
    const body = "![a](https://cdn.example/a.png)\n\n![b](https://cdn.example/b.png)";
    const next = rewriteMarkdownRemoteImageUrls(
      body,
      new Map([
        ["https://cdn.example/a.png", "/vault/media/id/a.png"],
        ["https://cdn.example/b.png", "/vault/media/id/b.png"],
      ]),
    );
    expect(next).toBe(
      "![a](/vault/media/id/a.png)\n\n![b](/vault/media/id/b.png)",
    );
  });

  it("preserves image titles when rewriting", () => {
    const body = '![a](https://cdn.example/a.png "title")';
    const next = rewriteMarkdownRemoteImageUrls(
      body,
      new Map([["https://cdn.example/a.png", "/vault/media/id/a.png"]]),
    );
    expect(next).toBe('![a](/vault/media/id/a.png "title")');
  });

  it("extracts reference-style, protocol-relative, and HTTPS case", () => {
    const body = [
      "![one][ref]",
      "",
      "![two](HTTPS://cdn.example/Two.PNG)",
      "",
      "![three](//cdn.example/three.jpg)",
      "",
      "[ref]: https://cdn.example/ref.png",
    ].join("\n");
    expect(extractMarkdownRemoteImageRefs(body).map((r) => r.rawUrl)).toEqual([
      "https://cdn.example/ref.png",
      "HTTPS://cdn.example/Two.PNG",
      "//cdn.example/three.jpg",
    ]);
  });

  it("builds YouTube teaser download URL without using it for display", () => {
    expect(
      youtubeTeaserDownloadUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  });
});

describe("localizeRemoteDisplayAssets (#739)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedNote(title: string, body: string, url: string | null = null) {
    dataDir = await mkdtemp(join(tmpdir(), "collector-localize-"));
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
        url,
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
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      content: body,
    });
    return { ctx, path, vaultId: meta.id, itemId };
  }

  it("downloads markdown images, attaches them, and rewrites body", async () => {
    const { ctx, path, vaultId, itemId } = await seedNote(
      "With image",
      "See ![shot](https://cdn.example/shot.png)",
    );
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetched: string[] = [];

    const result = await localizeRemoteDisplayAssets({
      ctx,
      vaultPath: path,
      vaultId,
      itemId,
      rawMarkdown: await readItemRawMarkdown(fs, path, itemId),
      fetchBytes: async (url) => {
        fetched.push(url);
        return bytes;
      },
      encodeCoverWebp: async () => new Uint8Array([9, 9]),
    });

    expect(fetched).toEqual(["https://cdn.example/shot.png"]);
    expect(result.changed).toBe(true);
    expect(result.text).not.toContain("https://cdn.example/shot.png");
    expect(result.text).toMatch(/!\[[^\]]*\]\(\/.*shot\.png\)/);
    const media = await listMediaFiles(fs, path, itemId);
    expect(media).toHaveLength(1);
    expect(media[0]!.filename).toBe("shot.png");
  });

  it("fails hard when markdown image download fails (no keep-remote)", async () => {
    const { ctx, path, vaultId, itemId } = await seedNote(
      "Broken",
      "![x](https://cdn.example/missing.png)",
    );

    await expect(
      localizeRemoteDisplayAssets({
        ctx,
        vaultPath: path,
        vaultId,
        itemId,
        rawMarkdown: await readItemRawMarkdown(fs, path, itemId),
        fetchBytes: async () => {
          throw new Error("network down");
        },
        encodeCoverWebp: async () => new Uint8Array([1]),
      }),
    ).rejects.toThrow(/failed to download markdown image/);

    const raw = await readItemRawMarkdown(fs, path, itemId);
    // Source on disk unchanged — localize did not write.
    expect(raw).toContain("https://cdn.example/missing.png");
  });

  it("downloads remote FM thumbnail into cover.webp and clears FM", async () => {
    const { ctx, path, vaultId, itemId } = await seedNote("Thumb", "body");
    const raw = serializeDocumentMarkdown(
      {
        title: "Thumb",
        thumbnail: "https://cdn.example/cover.jpg",
      },
      "body",
    );

    const result = await localizeRemoteDisplayAssets({
      ctx,
      vaultPath: path,
      vaultId,
      itemId,
      rawMarkdown: raw,
      fetchBytes: async () => new Uint8Array([7, 7, 7]),
      encodeCoverWebp: async (data) => {
        expect(data).toEqual(new Uint8Array([7, 7, 7]));
        return new Uint8Array([8, 8, 8]);
      },
    });

    expect(result.changed).toBe(true);
    expect(result.text).not.toMatch(/thumbnail:\s*https:/);
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(true);
    expect(await fs.readBinary(itemCoverPath(path, itemId))).toEqual(
      new Uint8Array([8, 8, 8]),
    );
  });

  it("downloads YouTube teaser once when cover is missing", async () => {
    const yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const { ctx, path, vaultId, itemId } = await seedNote("YT", "clip", yt);
    const fetched: string[] = [];

    const result = await localizeRemoteDisplayAssets({
      ctx,
      vaultPath: path,
      vaultId,
      itemId,
      rawMarkdown: await readItemRawMarkdown(fs, path, itemId),
      itemUrl: yt,
      fetchBytes: async (url) => {
        fetched.push(url);
        return new Uint8Array([3, 3, 3]);
      },
      encodeCoverWebp: async () => new Uint8Array([4, 4, 4]),
    });

    expect(fetched).toEqual([
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    ]);
    expect(result.changed).toBe(true);
    expect(await fs.exists(itemCoverPath(path, itemId))).toBe(true);
  });

  it("does not re-fetch YouTube teaser when cover.webp already exists", async () => {
    const yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const { ctx, path, vaultId, itemId } = await seedNote("YT", "clip", yt);
    await fs.mkdir(itemCoverPath(path, itemId).replace(/\/cover\.webp$/, ""));
    await fs.writeBinary(itemCoverPath(path, itemId), new Uint8Array([1]));

    const result = await localizeRemoteDisplayAssets({
      ctx,
      vaultPath: path,
      vaultId,
      itemId,
      rawMarkdown: await readItemRawMarkdown(fs, path, itemId),
      itemUrl: yt,
      fetchBytes: async () => {
        throw new Error("must not fetch");
      },
      encodeCoverWebp: async () => {
        throw new Error("must not encode");
      },
    });

    expect(result.changed).toBe(false);
  });

  it("does not leave attached media when a later download fails", async () => {
    const { ctx, path, vaultId, itemId } = await seedNote(
      "Partial",
      "![a](https://cdn.example/a.png)\n![b](https://cdn.example/b.png)",
    );
    let calls = 0;
    await expect(
      localizeRemoteDisplayAssets({
        ctx,
        vaultPath: path,
        vaultId,
        itemId,
        rawMarkdown: await readItemRawMarkdown(fs, path, itemId),
        fetchBytes: async () => {
          calls += 1;
          if (calls === 1) {
            return new Uint8Array([1, 2, 3]);
          }
          throw new Error("second failed");
        },
        encodeCoverWebp: async () => new Uint8Array([9]),
      }),
    ).rejects.toThrow(/second failed/);

    expect(await listMediaFiles(fs, path, itemId)).toEqual([]);
    const raw = await readItemRawMarkdown(fs, path, itemId);
    expect(raw).toContain("https://cdn.example/a.png");
  });

  it("cleans up attached media when cover encode fails after attach", async () => {
    const { ctx, path, vaultId, itemId } = await seedNote(
      "Encode fail",
      "body",
    );
    const raw =
      "---\ntitle: Encode fail\nthumbnail: https://cdn.example/thumb.jpg\n---\n\n![a](https://cdn.example/a.png)\n";
    await expect(
      localizeRemoteDisplayAssets({
        ctx,
        vaultPath: path,
        vaultId,
        itemId,
        rawMarkdown: raw,
        fetchBytes: async () => new Uint8Array([1, 2, 3, 4]),
        encodeCoverWebp: async () => {
          throw new Error("encode blew up");
        },
      }),
    ).rejects.toThrow(/encode blew up/);

    expect(await listMediaFiles(fs, path, itemId)).toEqual([]);
  });
});
