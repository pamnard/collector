/**
 * Reddit ExtractorPlugin — JSON fixtures + injectable fetch (#955).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  AttachMediaFileInput,
  GetItemResult,
  UpdateItemInput,
} from "@collector/api";
import { companionBodyUrlKeys } from "../companion-body-url-keys.js";
import { OFFLINE_PUBLIC_LOOKUP } from "../offline-public-lookup.js";
import {
  REDDIT_PLUGIN_ID,
  createRedditExtractorPlugin,
} from "./reddit-extractor-plugin.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const OK_ID = "img001";
const OK_URL = `https://www.reddit.com/r/pics/comments/${OK_ID}/a_nice_mountain/`;
const TEXT_ID = "text01";
const TEXT_URL =
  "https://www.reddit.com/r/askscience/comments/text01/why_is_the_sky_blue/";
const FAIL_ID = "priv01";
const FAIL_URL = `https://www.reddit.com/r/pics/comments/${FAIL_ID}/`;

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function jsonResponse(body: string, init: { status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, init: { status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
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
  const image = readFixture("image-post.json");
  const text = readFixture("text-post.json");
  const wall = readFixture("login-wall.html");
  const cdn = options?.cdn ?? "ok";

  return async (input) => {
    const url = String(input);

    if (url.includes(`/comments/${OK_ID}`) && url.endsWith(".json")) {
      return jsonResponse(image);
    }
    if (url.includes(`/comments/${TEXT_ID}`) && url.endsWith(".json")) {
      return jsonResponse(text);
    }
    if (url.includes("i.redd.it/abc123mountain.jpg")) {
      if (cdn === "fail") {
        throw new Error("CDN boom");
      }
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (url.includes(`/comments/${FAIL_ID}`)) {
      return textResponse(wall, { status: 403 });
    }
    throw new Error(
      `unexpected URL in reddit-extractor-plugin fixture fetch: ${url}`,
    );
  };
}

function unusedVault(): never {
  throw new Error("vault write must not run in this test");
}

describe("createRedditExtractorPlugin (#955)", () => {
  it("companionBodyUrlKeys via both prefixes strips share + redd.it pair", () => {
    const keys = [
      ...new Set([
        ...companionBodyUrlKeys(
          [{ shortcode: "share:QcY" }, { shortcode: "reddit:img001" }],
          "share:QcY",
          "img001",
          "share:",
        ),
        ...companionBodyUrlKeys(
          [{ shortcode: "share:QcY" }, { shortcode: "reddit:img001" }],
          "share:QcY",
          "img001",
          "reddit:",
        ),
      ]),
    ].sort();
    expect(keys).toEqual(["img001", "reddit:img001", "share:QcY"]);
  });

  it("companionBodyUrlKeys strips lone redd.it + full post pair", () => {
    expect(
      companionBodyUrlKeys(
        [{ shortcode: "img001" }, { shortcode: "reddit:img001" }],
        "img001",
        "img001",
        "reddit:",
      ).sort(),
    ).toEqual(["img001", "reddit:img001"]);
  });

  it("discover maps shortcode into ExtractCandidate.meta", () => {
    const plugin = createRedditExtractorPlugin({
      cookieHeader: "reddit_session=fixture",
      getItemById: async () => unusedVault(),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
    });

    const candidates = plugin.discover({
      body: `see ${OK_URL} here`,
    });
    expect(candidates).toEqual([
      {
        extractorId: REDDIT_PLUGIN_ID,
        url: `https://www.reddit.com/r/pics/comments/${OK_ID}/`,
        meta: { shortcode: OK_ID },
      },
    ]);
  });

  it("extract imports image post into title/body/url and attaches CDN bytes", async () => {
    const writes = emptyWrites();
    let note = fakeNote({
      body: `Keep me\n\n${OK_URL}\n`,
    });

    const plugin = createRedditExtractorPlugin({
      cookieHeader: "reddit_session=fixture",
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
        return [];
      },
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await plugin.extract({
      itemId: note.item.id,
      candidate: {
        extractorId: REDDIT_PLUGIN_ID,
        url: `https://www.reddit.com/r/pics/comments/${OK_ID}/`,
        meta: { shortcode: OK_ID },
      },
    });

    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]?.input.title).toBe("A nice mountain");
    expect(writes.updates[0]?.input.url).toContain(OK_ID);
    expect(writes.updates[0]?.input.content).toContain("Keep me");
    expect(writes.updates[0]?.input.content).not.toContain("reddit.com");
    expect(writes.attaches).toHaveLength(1);
    expect(writes.attaches[0]?.files[0]?.name).toBe("img001-1.jpg");
    expect(writes.attaches[0]?.files[0]?.bytes).toEqual(JPEG);
  });

  it("extract succeeds for text-only posts without attachMediaFiles", async () => {
    const writes = emptyWrites();
    let note = fakeNote({ body: TEXT_URL });

    const plugin = createRedditExtractorPlugin({
      cookieHeader: "reddit_session=fixture",
      getItemById: async () => note,
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return note.item;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.attaches.push({ itemId, files });
        return [];
      },
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await plugin.extract({
      itemId: note.item.id,
      candidate: {
        extractorId: REDDIT_PLUGIN_ID,
        url: TEXT_URL,
        meta: { shortcode: TEXT_ID },
      },
    });

    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]?.input.title).toBe("Why is the sky blue?");
    expect(writes.updates[0]?.input.content).toContain("Rayleigh");
    expect(writes.attaches).toHaveLength(0);
  });

  it("refuses extract when matching URL is gone from body", async () => {
    const plugin = createRedditExtractorPlugin({
      cookieHeader: "reddit_session=fixture",
      getItemById: async () =>
        fakeNote({ body: "already imported — no reddit url left" }),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch(),
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: REDDIT_PLUGIN_ID,
          url: `https://www.reddit.com/r/pics/comments/${OK_ID}/`,
          meta: { shortcode: OK_ID },
        },
      }),
    ).rejects.toThrow(/no matching Reddit URL/);
  });

  it("does not write the note when CDN download fails", async () => {
    const writes = emptyWrites();
    const plugin = createRedditExtractorPlugin({
      cookieHeader: "reddit_session=fixture",
      getItemById: async () => fakeNote({ body: OK_URL }),
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return unusedVault();
      },
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch({ cdn: "fail" }),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: REDDIT_PLUGIN_ID,
          url: `https://www.reddit.com/r/pics/comments/${OK_ID}/`,
          meta: { shortcode: OK_ID },
        },
      }),
    ).rejects.toThrow(/CDN boom/);
    expect(writes.updates).toHaveLength(0);
  });

  it("fails loudly on login wall without writing", async () => {
    const writes = emptyWrites();
    const plugin = createRedditExtractorPlugin({
      cookieHeader: "reddit_session=fixture",
      getItemById: async () => fakeNote({ body: FAIL_URL }),
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return unusedVault();
      },
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch(),
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: REDDIT_PLUGIN_ID,
          url: FAIL_URL,
          meta: { shortcode: FAIL_ID },
        },
      }),
    ).rejects.toThrow(/login_wall|private_or_unavailable|Reddit extract failed/);
    expect(writes.updates).toHaveLength(0);
  });
});
