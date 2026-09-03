/**
 * YouTube ExtractorPlugin — injectable fetch (no live yt-dlp / network).
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AttachMediaFileInput,
  GetItemResult,
  UpdateItemInput,
} from "@collector/api";
import { resolveYtdlpBinary } from "./resolve-ytdlp.js";
import {
  YOUTUBE_PLUGIN_ID,
  createYoutubeExtractorPlugin,
} from "./youtube-extractor-plugin.js";
import type { YoutubeFetchResult } from "./types.js";

const OK_ID = "dQw4w9WgXcQ";
const OK_URL = `https://www.youtube.com/watch?v=${OK_ID}`;
const SAMPLE_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

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
  attaches: Array<{ itemId: string; files: AttachMediaFileInput[] }>;
};

function emptyWrites(): VaultWrite {
  return { order: [], updates: [], attaches: [] };
}

function okFetch(transcript: string | null): YoutubeFetchResult {
  return {
    ok: true,
    value: {
      sourceUrl: OK_URL,
      videoId: OK_ID,
      title: "Never Gonna Give You Up",
      transcript,
      videoBytes: SAMPLE_BYTES,
      videoFilename: `${OK_ID}.mp4`,
    },
  };
}

describe("createYoutubeExtractorPlugin (#317)", () => {
  const envDirs: string[] = [];

  afterEach(() => {
    for (const dir of envDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.COLLECTOR_YT_DLP;
  });

  it("discover returns youtube candidates from body", () => {
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: "" }),
      updateItem: async () => undefined,
      attachMediaFiles: async () => undefined,
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
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () =>
        fakeNote({ body: `Keep\n\n${OK_URL}\n` }),
      updateItem: async (itemId, input) => {
        writes.order.push("update");
        writes.updates.push({ itemId, input });
        return undefined;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.order.push("attach");
        writes.attaches.push({ itemId, files });
        return undefined;
      },
      fetchYoutubeImpl: async () => okFetch("Line one\nLine two"),
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
    expect(writes.attaches[0]?.files[0]?.bytes).toEqual(SAMPLE_BYTES);
  });

  it("leaves body URL when attach fails so extract can retry", async () => {
    const writes = emptyWrites();
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: `${OK_URL}\n` }),
      updateItem: async (itemId, input) => {
        writes.order.push("update");
        writes.updates.push({ itemId, input });
        return undefined;
      },
      attachMediaFiles: async () => {
        writes.order.push("attach");
        throw new Error("attach boom");
      },
      fetchYoutubeImpl: async () => okFetch(null),
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
  });

  it("extract succeeds without transcript and still strips URL", async () => {
    const writes = emptyWrites();
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: `${OK_URL}\n` }),
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return undefined;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.attaches.push({ itemId, files });
        return undefined;
      },
      fetchYoutubeImpl: async () => okFetch(null),
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
    expect(writes.attaches[0]?.files).toHaveLength(1);
  });

  it("refuses extract when URL already gone from body", async () => {
    const plugin = createYoutubeExtractorPlugin({
      getItemById: async () => fakeNote({ body: "already imported\n" }),
      updateItem: async () => {
        throw new Error("vault write must not run");
      },
      attachMediaFiles: async () => {
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
