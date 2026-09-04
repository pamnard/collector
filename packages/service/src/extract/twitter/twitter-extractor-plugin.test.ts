/**
 * Twitter ExtractorPlugin — fixtures + injectable fetch (#954).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  AttachMediaFileInput,
  GetItemResult,
  MediaWithPath,
  UpdateItemInput,
} from "@collector/api";
import {
  TWITTER_PLUGIN_ID,
  createTwitterExtractorPlugin,
} from "./twitter-extractor-plugin.js";
import { OFFLINE_PUBLIC_LOOKUP } from "../offline-public-lookup.js";

import { companionBodyUrlKeys } from "../companion-body-url-keys.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const OK_STATUS_ID = "20";
const OK_STATUS_URL = `https://x.com/jack/status/${OK_STATUS_ID}`;
const FAIL_ARTICLE_ID = "Secret99";
const FAIL_ARTICLE_URL = `https://x.com/writer/article/${FAIL_ARTICLE_ID}`;
const OK_ARTICLE_ID = "ArtId01";
const OK_ARTICLE_URL = `https://x.com/writer/article/${OK_ARTICLE_ID}`;
const ARTICLE_CDN = "https://pbs.twimg.com/media/fixture-article.jpg";

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function attachedPaths(
  itemId: string,
  files: AttachMediaFileInput[],
): MediaWithPath[] {
  return files.map((file, index) => ({
    id: `media-${index}`,
    item_id: itemId,
    filename: file.name,
    media_type: "image" as const,
    created_at: "2026-01-01T00:00:00.000Z",
    absolute_path: `/vault/media/${file.name}`,
  }));
}

function textResponse(
  body: string,
  init: { status?: number; url?: string; contentType?: string } = {},
): Response {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": init.contentType ?? "text/html; charset=utf-8",
    },
  });
  if (init.url) {
    Object.defineProperty(response, "url", {
      value: init.url,
      configurable: true,
    });
  }
  return response;
}

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
  updates: Array<{ itemId: string; input: UpdateItemInput }>;
  attaches: Array<{ itemId: string; files: AttachMediaFileInput[] }>;
};

function emptyWrites(): VaultWrite {
  return { updates: [], attaches: [] };
}

function createFixtureFetch(options?: {
  cdn?: "ok" | "fail";
}): typeof fetch {
  const status = readFixture("status-syndication.json");
  const article = readFixture("article-page.html");
  const wall = readFixture("login-wall.html");
  const cdn = options?.cdn ?? "ok";

  return async (input) => {
    const url = String(input);

    if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
      if (url.includes(`id=${OK_STATUS_ID}`)) {
        return textResponse(status, { contentType: "application/json" });
      }
      return textResponse("{}", {
        status: 404,
        contentType: "application/json",
      });
    }
    if (url.includes(`/article/${OK_ARTICLE_ID}`)) {
      return textResponse(article);
    }
    if (url.includes(`/article/${FAIL_ARTICLE_ID}`)) {
      return textResponse(wall, { status: 200 });
    }
    if (
      url.includes("pbs.twimg.com/media/fixture-status.jpg") ||
      url.includes("pbs.twimg.com/media/fixture-article.jpg")
    ) {
      if (cdn === "fail") {
        throw new Error("CDN boom");
      }
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    throw new Error(
      `unexpected URL in twitter-extractor-plugin fixture fetch: ${url}`,
    );
  };
}

function unusedVault(): never {
  throw new Error("vault write must not run in this test");
}

describe("createTwitterExtractorPlugin (#954)", () => {
  it("companionBodyUrlKeys strips lone t.co + status pair", () => {
    expect(
      companionBodyUrlKeys(
        [
          { shortcode: "20" },
          { shortcode: "tco:AbCdEf12" },
        ],
        "20",
        "20",
        "tco:",
      ).sort(),
    ).toEqual(["20", "tco:AbCdEf12"]);
  });

  it("discover maps shortcode into ExtractCandidate.meta", () => {
    const plugin = createTwitterExtractorPlugin({
      getItemById: async () => unusedVault(),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
    });

    const candidates = plugin.discover({
      body: `see ${OK_STATUS_URL} here`,
    });
    expect(candidates).toEqual([
      {
        extractorId: TWITTER_PLUGIN_ID,
        url: OK_STATUS_URL,
        meta: { shortcode: OK_STATUS_ID },
      },
    ]);
  });

  it("extract parses syndication into title/body/url and attaches CDN bytes", async () => {
    const writes = emptyWrites();
    let note = fakeNote({
      body: `Keep me\n\n${OK_STATUS_URL}\n`,
    });

    const plugin = createTwitterExtractorPlugin({
      getItemById: async () => note,
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        note = {
          ...note,
          item: {
            ...note.item,
            title: input.title ?? note.item.title,
            url: input.url !== undefined ? input.url : note.item.url,
          },
          content:
            input.content !== undefined ? (input.content ?? "") : note.content,
        };
        return note.item;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.attaches.push({ itemId, files });
        return attachedPaths(itemId, files);
      },
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    const candidates = plugin.discover({ body: note.content ?? "" });
    await plugin.extract({ itemId: note.item.id, candidate: candidates[0]! });

    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]!.input.title).toBe("just setting up my twttr");
    expect(writes.updates[0]!.input.url).toContain("/status/20");
    expect(writes.updates[0]!.input.content).toContain("Keep me");
    expect(writes.updates[0]!.input.content).not.toContain(OK_STATUS_URL);
    expect(writes.attaches).toHaveLength(1);
    expect(writes.attaches[0]!.files[0]!.name).toBe(`${OK_STATUS_ID}-1.jpg`);
    expect(writes.attaches[0]!.files[0]!.bytes).toEqual(JPEG);
  });

  it("extract imports article with full text and attaches media", async () => {
    const writes = emptyWrites();
    let note = fakeNote({ body: `${OK_ARTICLE_URL}\n` });

    const plugin = createTwitterExtractorPlugin({
      getItemById: async () => note,
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        note = {
          ...note,
          content:
            input.content !== undefined ? (input.content ?? "") : note.content,
        };
        return note.item;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.attaches.push({ itemId, files });
        return attachedPaths(itemId, files);
      },
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await plugin.extract({
      itemId: note.item.id,
      candidate: {
        extractorId: TWITTER_PLUGIN_ID,
        url: OK_ARTICLE_URL,
        meta: { shortcode: `article:${OK_ARTICLE_ID}` },
      },
    });

    expect(writes.updates[0]!.input.title).toBe("Deep dive into notes");
    expect(writes.updates[0]!.input.content).toContain(
      "Paragraph two with more detail",
    );
    expect(writes.updates[0]!.input.content).not.toContain(ARTICLE_CDN);
    expect(writes.updates[0]!.input.content).toContain(
      `![](/vault/media/${OK_ARTICLE_ID}-1.jpg)`,
    );
    expect(writes.attaches).toHaveLength(1);
    expect(writes.attaches[0]!.files[0]!.name).toBe(`${OK_ARTICLE_ID}-1.jpg`);
  });

  it("refuses extract when URL is no longer in the body", async () => {
    const plugin = createTwitterExtractorPlugin({
      getItemById: async () => fakeNote({ body: "already imported\n" }),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: TWITTER_PLUGIN_ID,
          url: OK_STATUS_URL,
          meta: { shortcode: OK_STATUS_ID },
        },
      }),
    ).rejects.toThrow(/no matching Twitter\/X URL/);
  });

  it("does not write the note when CDN download fails", async () => {
    const plugin = createTwitterExtractorPlugin({
      getItemById: async () =>
        fakeNote({ body: `Keep me\n\n${OK_STATUS_URL}\n` }),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch({ cdn: "fail" }),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: TWITTER_PLUGIN_ID,
          url: OK_STATUS_URL,
          meta: { shortcode: OK_STATUS_ID },
        },
      }),
    ).rejects.toThrow(/CDN boom/);
  });

  it("fails loudly on login wall without vault writes", async () => {
    const plugin = createTwitterExtractorPlugin({
      getItemById: async () => fakeNote({ body: `${FAIL_ARTICLE_URL}\n` }),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: TWITTER_PLUGIN_ID,
          url: FAIL_ARTICLE_URL,
          meta: { shortcode: `article:${FAIL_ARTICLE_ID}` },
        },
      }),
    ).rejects.toThrow(/Twitter extract failed/);
  });
});
