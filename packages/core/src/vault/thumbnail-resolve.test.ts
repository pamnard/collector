import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileSystemAdapter } from "../adapters/types.js";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { applyItemCover } from "./cover-operations.js";
import { attachMediaFile } from "./media-operations.js";
import { createVault } from "./vault-operations.js";
import { upsertItem } from "./item-operations.js";
import { itemCoverPath, itemMediaRoot, joinSegments } from "./paths.js";
import {
  resolveItemThumbnailPathsBatch,
  resolveItemThumbnailPathsProgressive,
} from "./thumbnail-resolve.js";

describe("resolveItemThumbnailPathsBatch", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedItem(title: string) {
    dataDir = await mkdtemp(join(tmpdir(), "collector-thumb-"));
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

  /** FS that lists a fixed media dir and forbids per-candidate exists/stat. */
  function galleryListingFs(options: {
    cover: string;
    mediaRoot: string;
    mediaNames: string[];
    existsPaths?: string[];
  }): FileSystemAdapter {
    const base = new NodeFileSystemAdapter();
    return {
      ...base,
      async exists(path: string): Promise<boolean> {
        options.existsPaths?.push(path);
        if (path === options.cover) {
          return false;
        }
        if (path === options.mediaRoot) {
          return true;
        }
        throw new Error(`unexpected exists probe: ${path}`);
      },
      async readDirEntries(path: string) {
        expect(path).toBe(options.mediaRoot);
        return options.mediaNames.map((name) => ({
          name,
          isDirectory: false,
        }));
      },
      async stat(): Promise<{ mtimeMs: number | null; sizeBytes: number | null }> {
        throw new Error("unexpected stat probe");
      },
    };
  }

  it("returns cover path when cover.webp exists on disk", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Covered");
    const coverBytes = new TextEncoder().encode("fake-webp");
    await applyItemCover(ctx, path, vaultId, itemId, coverBytes, { width: 320, height: 240 });

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: null },
    ]);

    expect(rows).toEqual([
      {
        id: itemId,
        path: itemCoverPath(path, itemId),
      },
    ]);
  });

  it("prefers cover.webp over stale frontmatter sidecar path", async () => {
    const { ctx, path, vaultId, itemId } = await seedItem("Stale FM");
    const coverBytes = new TextEncoder().encode("fake-webp");
    await applyItemCover(ctx, path, vaultId, itemId, coverBytes, { width: 320, height: 240 });
    const uuid = itemId.replace(/\.md$/, "");

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: `${uuid}.media/cover.webp` },
    ]);

    expect(rows).toEqual([
      {
        id: itemId,
        path: itemCoverPath(path, itemId),
      },
    ]);
  });

  it("falls back to first image media when cover missing", async () => {
    const { ctx, path, itemId } = await seedItem("No cover");
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const media = await attachMediaFile(ctx, path, itemId, {
      filename: "shot.png",
      data: pngBytes,
    });

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: null },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(itemId);
    expect(rows[0]!.path).toContain(`${media.id}-shot.png`);
    expect(await fs.exists(rows[0]!.path!)).toBe(true);
  });

  it("returns null when no cover and no image media", async () => {
    const { path, itemId } = await seedItem("Empty");

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: null },
    ]);

    expect(rows).toEqual([{ id: itemId, path: null }]);
  });

  it("ignores remote http thumbnail — not a local display asset (#739)", async () => {
    const { path, itemId } = await seedItem("Remote");
    const remote = "https://example.com/thumb.jpg";

    const rows = await resolveItemThumbnailPathsBatch(fs, path, [
      { id: itemId, thumbnail: remote },
    ]);

    expect(rows).toEqual([{ id: itemId, path: null }]);
  });

  it("gallery fallback does not exists-probe every media candidate (#711)", async () => {
    const itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md";
    const vaultPath = "/vault";
    const mediaRoot = itemMediaRoot(vaultPath, itemId);
    const cover = itemCoverPath(vaultPath, itemId);
    const imageName = "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz-shot.png";
    const imagePath = joinSegments(mediaRoot, imageName);
    const existsPaths: string[] = [];

    const rows = await resolveItemThumbnailPathsBatch(
      galleryListingFs({
        cover,
        mediaRoot,
        existsPaths,
        mediaNames: [
          ...Array.from({ length: 20 }, (_, i) => `clip-${i}.mp4`),
          ...Array.from({ length: 20 }, (_, i) => `note-${i}.pdf`),
          imageName,
        ],
      }),
      vaultPath,
      [{ id: itemId, thumbnail: null }],
    );

    expect(rows).toEqual([{ id: itemId, path: imagePath }]);
    expect(existsPaths).toEqual([cover, mediaRoot]);
  });

  it("gallery fallback picks lexicographic min image name, not listing or mtime order (#711)", async () => {
    const itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md";
    const vaultPath = "/vault";
    const mediaRoot = itemMediaRoot(vaultPath, itemId);
    const cover = itemCoverPath(vaultPath, itemId);
    // Listing order puts zebra first; lex-min among images is apple.
    const expectedName = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-apple.webp";

    const rows = await resolveItemThumbnailPathsBatch(
      galleryListingFs({
        cover,
        mediaRoot,
        mediaNames: [
          "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz-zebra.png",
          "clip.mp4",
          "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm-mango.jpg",
          expectedName,
          "note.pdf",
        ],
      }),
      vaultPath,
      [{ id: itemId, thumbnail: null }],
    );

    expect(rows).toEqual([
      { id: itemId, path: joinSegments(mediaRoot, expectedName) },
    ]);
  });
});

describe("resolveItemThumbnailPathsProgressive", () => {
  const slowId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md";
  const fastId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.md";
  const afterAbortId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc.md";

  function wrapWithLatches(
    inner: FileSystemAdapter,
    options: {
      delayExistsFor: (path: string) => Promise<void> | void;
      onExistsStart?: () => void;
      onExistsEnd?: () => void;
    },
  ): FileSystemAdapter {
    return {
      ...inner,
      async exists(path: string): Promise<boolean> {
        options.onExistsStart?.();
        try {
          await options.delayExistsFor(path);
          return inner.exists(path);
        } finally {
          options.onExistsEnd?.();
        }
      },
    };
  }

  it("emits fast item before slow sibling finishes", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let slowStarted = false;

    const base = new NodeFileSystemAdapter();
    const fs = wrapWithLatches(base, {
      delayExistsFor: async (path) => {
        if (path.includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")) {
          slowStarted = true;
          await slowGate;
        }
      },
    });

    const order: string[] = [];
    await resolveItemThumbnailPathsProgressive(
      fs,
      "/vault",
      [
        // Slow first so a concurrent worker is blocked before fast finishes.
        { id: slowId, thumbnail: null },
        { id: fastId, thumbnail: null },
      ],
      {
        concurrency: 2,
        onResolved: (result) => {
          order.push(result.id);
          if (result.id === fastId) {
            expect(slowStarted).toBe(true);
            releaseSlow?.();
          }
        },
      },
    );

    expect(order[0]).toBe(fastId);
    expect(order).toEqual([fastId, slowId]);
  });

  it("never runs more than concurrency exists probes at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const base = new NodeFileSystemAdapter();
    const fs = wrapWithLatches(base, {
      delayExistsFor: async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
      onExistsStart: () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
      },
      onExistsEnd: () => {
        inFlight -= 1;
      },
    });

    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(i).padStart(2, "0")}.md`,
      thumbnail: null as string | null,
    }));

    await resolveItemThumbnailPathsProgressive(fs, "/vault", items, {
      concurrency: 2,
      onResolved: () => {},
    });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("does not emit after abort", async () => {
    const controller = new AbortController();
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const base = new NodeFileSystemAdapter();
    const fs = wrapWithLatches(base, {
      delayExistsFor: async (path) => {
        if (path.includes("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")) {
          await slowGate;
        }
      },
    });

    const emitted: string[] = [];
    const run = resolveItemThumbnailPathsProgressive(
      fs,
      "/vault",
      [
        { id: slowId, thumbnail: null },
        { id: afterAbortId, thumbnail: null },
      ],
      {
        concurrency: 1,
        signal: controller.signal,
        onResolved: (result) => {
          emitted.push(result.id);
        },
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    releaseSlow?.();
    await run;

    expect(emitted).toEqual([]);
  });
});
