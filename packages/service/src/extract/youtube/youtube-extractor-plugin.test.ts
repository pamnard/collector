/**
 * YouTube ExtractorPlugin — injectable fetch (no live yt-dlp / network).
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { GetItemResult, UpdateItemInput } from "@collector/api";
import { resolveYtdlpBinary } from "./resolve-ytdlp.js";
import {
  YOUTUBE_PLUGIN_ID,
  createYoutubeExtractorPlugin,
  type YoutubeAttachFromPathInput,
} from "./youtube-extractor-plugin.js";
import type { YoutubeFetchResult } from "./types.js";

const OK_ID = "dQw4w9WgXcQ";
const OK_URL = `https://www.youtube.com/watch?v=${OK_ID}`;

function fakeNote(input: {
  id?: string;
  body: string;
  url?: string | null;
  title?: string;
}): GetItemResult {
  const id = input.id ?? "Inbox/note.md";
  return {
    item: {
      id,
      vault_id: "vault-1",
      title: input.title ?? "Capture",
      description: "",
      url: input.url ?? null,
      content_type: "bookmark",
      source_type: "manual",
      metadata: {},
      properties: {},
      thumbnail: null,
      tag_ids: [],
      collection_ids: [],
      folder_path: "Inbox",
      content_revision: 1,
      word_count: 0,
      character_count: 0,
    },
    content: input.body,
  };
}

type VaultWrite = {
  order: string[];
  updates: Array<{ itemId: string; input: UpdateItemInput }>;
  attaches: Array<{ itemId: string; file: YoutubeAttachFromPathInput }>;
};

function emptyWrites(): VaultWrite {
  return { order: [], updates: [], attaches: [] };
}

function okFetch(
  transcript: string | null,
  videoPath: string,
): YoutubeFetchResult {
  return {
    ok: true,
    value: {
      sourceUrl: OK_URL,
      videoId: OK_ID,
      title: "Never Gonna Give You Up",
      transcript,
      videoPath,
      videoFilename: `${OK_ID}.mp4`,
      release: () => undefined,
    },
  };
}

describe("createYoutubeExtractorPlugin (#317)", () => {
  const envDirs: string[] = [];
  let samplePath = "";

  afterEach(() => {
    for (const dir of envDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.COLLECTOR_YT_DLP;
  });

  function ensureSampleVideo(): string {
    if (samplePath) {
      return samplePath;
    }
    const dir = join(tmpdir(), `collector-yt-plugin-${Date.now()}`);
    envDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    samplePath = join(dir, `${OK_ID}.mp4`);
    writeFileSync(samplePath, Buffer.from([0x00, 0x00, 0x00, 0x18]));
    return samplePath;
  }

  it("discover returns youtube candidates from body", () => {
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: "" }),
      updateItem: async () => undefined,
      attachMediaFromPath: async () => undefined,
    });
    expect(
      plugin.discover({
        body: `see ${OK_URL}\n`,
        frontmatterUrl: "https://www.youtube.com/watch?v=ignoredFront",
      }),
    ).toEqual([
      {
        extractorId: YOUTUBE_PLUGIN_ID,
        url: OK_URL,
        meta: { shortcode: OK_ID },
      },
    ]);
  });

  it("extract attaches before updateItem (strip URL only after attach)", async () => {
    const writes = emptyWrites();
    const path = ensureSampleVideo();
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () =>
        fakeNote({ body: `Keep\n\n${OK_URL}\n` }),
      updateItem: async (itemId, input) => {
        writes.order.push("update");
        writes.updates.push({ itemId, input });
        return undefined;
      },
      attachMediaFromPath: async (itemId, file) => {
        writes.order.push("attach");
        writes.attaches.push({ itemId, file });
        return undefined;
      },
      fetchYoutubeImpl: async () => okFetch("Line one\nLine two", path),
    });

    await plugin.extract({
      itemId: "Inbox/note.md",
      candidate: {
        extractorId: YOUTUBE_PLUGIN_ID,
        url: OK_URL,
        meta: { shortcode: OK_ID },
      },
    });

    expect(writes.order).toEqual(["attach", "update"]);
    expect(writes.updates[0]?.input.title).toBe("Never Gonna Give You Up");
    expect(writes.updates[0]?.input.content).not.toContain("youtube.com");
    expect(writes.attaches[0]?.file.absolutePath).toBe(path);
    expect(writes.attaches[0]?.file.name).toBe(`${OK_ID}.mp4`);
  });

  it("leaves body URL when attach fails so extract can retry", async () => {
    const writes = emptyWrites();
    const path = ensureSampleVideo();
    let released = false;
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: `${OK_URL}\n` }),
      updateItem: async (itemId, input) => {
        writes.order.push("update");
        writes.updates.push({ itemId, input });
        return undefined;
      },
      attachMediaFromPath: async () => {
        writes.order.push("attach");
        throw new Error("attach boom");
      },
      fetchYoutubeImpl: async () => {
        const base = okFetch(null, path);
        if (!base.ok) {
          return base;
        }
        return {
          ok: true,
          value: {
            ...base.value,
            release: () => {
              released = true;
            },
          },
        };
      },
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: YOUTUBE_PLUGIN_ID,
          url: OK_URL,
          meta: { shortcode: OK_ID },
        },
      }),
    ).rejects.toThrow(/attach boom/);
    expect(writes.order).toEqual(["attach"]);
    expect(writes.updates).toHaveLength(0);
    expect(released).toBe(true);
  });

  it("extract succeeds without transcript and still strips URL", async () => {
    const writes = emptyWrites();
    const path = ensureSampleVideo();
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: `${OK_URL}\n` }),
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return undefined;
      },
      attachMediaFromPath: async (itemId, file) => {
        writes.attaches.push({ itemId, file });
        return undefined;
      },
      fetchYoutubeImpl: async () => okFetch(null, path),
    });

    await plugin.extract({
      itemId: "Inbox/note.md",
      candidate: {
        extractorId: YOUTUBE_PLUGIN_ID,
        url: OK_URL,
        meta: { shortcode: OK_ID },
      },
    });

    expect(writes.updates[0]?.input.title).toBe("Never Gonna Give You Up");
    expect(writes.updates[0]?.input.content).not.toContain("youtube.com");
    expect(writes.attaches).toHaveLength(1);
  });

  it("refuses extract when URL already gone from body", async () => {
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: "already imported\n" }),
      updateItem: async () => {
        throw new Error("vault write must not run");
      },
      attachMediaFromPath: async () => {
        throw new Error("attach must not run");
      },
      fetchYoutubeImpl: async () => {
        throw new Error("fetch must not run");
      },
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: YOUTUBE_PLUGIN_ID,
          url: OK_URL,
          meta: { shortcode: OK_ID },
        },
      }),
    ).rejects.toThrow(/no matching YouTube URL/);
  });

  it("resolveYtdlpBinary honors COLLECTOR_YT_DLP when file exists", () => {
    const dir = join(tmpdir(), `collector-ytdlp-resolve-${Date.now()}`);
    envDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, "yt-dlp");
    writeFileSync(bin, "#!/bin/sh\necho ok\n", { mode: 0o755 });
    process.env.COLLECTOR_YT_DLP = bin;
    expect(resolveYtdlpBinary()).toBe(bin);
  });

  it("resolveYtdlpBinary returns null for missing COLLECTOR_YT_DLP path", () => {
    process.env.COLLECTOR_YT_DLP = join(
      tmpdir(),
      "collector-ytdlp-missing-does-not-exist",
    );
    expect(resolveYtdlpBinary()).toBeNull();
  });
});
