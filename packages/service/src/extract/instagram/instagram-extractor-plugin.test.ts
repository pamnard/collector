/**
 * Instagram ExtractorPlugin — HTML fixtures + injectable fetch (not pre-parsed
 * fetch/CDN theater). Asserts merge title/body/url + attach bytes.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AttachMediaFileInput, GetItemResult, UpdateItemInput } from "@collector/api";
import {
  INSTAGRAM_PLUGIN_ID,
  createInstagramExtractorPlugin,
} from "./instagram-extractor-plugin.js";
import { OFFLINE_PUBLIC_LOOKUP } from "../offline-public-lookup.js";


const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const OK_SHORTCODE = "CxImage01ab";
const OK_URL = `https://www.instagram.com/p/${OK_SHORTCODE}/`;
const FAIL_SHORTCODE = "LoginWall1";
const FAIL_URL = `https://www.instagram.com/p/${FAIL_SHORTCODE}/`;

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
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
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
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

/** Fixture-backed Instagram HTTP — no live network. */
function createFixtureFetch(options?: {
  cdn?: "ok" | "fail";
}): typeof fetch {
  const singleEmbed = readFixture("single-image-embed.html");
  const loginWall = readFixture("login-wall-embed.html");
  const cdn = options?.cdn ?? "ok";

  return async (input) => {
    const url = String(input);

    if (url.includes(`/${OK_SHORTCODE}/embed/`)) {
      return textResponse(singleEmbed);
    }
    if (url.includes("cdn.instagram.fixture/single.jpg")) {
      if (cdn === "fail") {
        throw new Error("CDN boom");
      }
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }

    // Login-wall layers for FAIL_SHORTCODE (same shape as fetch.test.ts).
    if (url.includes(`/${FAIL_SHORTCODE}/embed/`)) {
      return textResponse(loginWall);
    }
    if (url === "https://www.instagram.com/" || url === "https://www.instagram.com") {
      return textResponse(loginWall, {
        headers: { "set-cookie": "csrftoken=fixture_csrf; Path=/" },
      });
    }
    if (url.includes("/web/get_ruling_for_content/")) {
      return jsonResponse(
        { status: "fail", title: "login_required" },
        { status: 200 },
      );
    }
    if (url.includes("/graphql/query/")) {
      return textResponse(loginWall, { status: 403 });
    }
    if (url.includes(`/p/${FAIL_SHORTCODE}`) && !url.includes("/embed/")) {
      return textResponse(loginWall);
    }
    if (url.includes("/api/v1/media/")) {
      return jsonResponse({ message: "login_required" }, { status: 403 });
    }
    if (url.includes("/api/graphql")) {
      return jsonResponse({ data: { xig_polaris_media: {} } });
    }

    throw new Error(`unexpected URL in instagram-extractor-plugin fixture fetch: ${url}`);
  };
}

function unusedVault(): never {
  throw new Error("vault write must not run in this test");
}

describe("createInstagramExtractorPlugin (#318)", () => {
  it("discover maps shortcode into ExtractCandidate.meta", () => {
    const plugin = createInstagramExtractorPlugin({
      getItemById: async () => unusedVault(),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
    });

    const candidates = plugin.discover({
      body: `see ${OK_URL} here`,
    });
    expect(candidates).toEqual([
      {
        extractorId: INSTAGRAM_PLUGIN_ID,
        url: OK_URL,
        meta: { shortcode: OK_SHORTCODE },
      },
    ]);
  });

  it("extract parses fixture HTML into title/body/url and attaches CDN bytes", async () => {
    const writes = emptyWrites();
    let note = fakeNote({
      body: `Keep me\n\n${OK_URL}\n`,
    });

    const plugin = createInstagramExtractorPlugin({
      getItemById: async () => note,
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        note = {
          item: {
            ...note.item,
            title: input.title ?? note.item.title,
            url: input.url !== undefined ? input.url : note.item.url,
            content_type: input.content_type ?? note.item.content_type,
          },
          content: input.content ?? note.content,
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
      itemId: "Inbox/note.md",
      candidate: {
        extractorId: INSTAGRAM_PLUGIN_ID,
        url: OK_URL,
        meta: { shortcode: OK_SHORTCODE },
      },
    });

    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]).toEqual({
      itemId: "Inbox/note.md",
      input: {
        title: "Morning ride",
        content: expect.stringContaining("Morning ride"),
        url: OK_URL,
        content_type: "note",
      },
    });
    const content = writes.updates[0]!.input.content as string;
    expect(content).toContain("Keep me");
    expect(content).toContain("#bike");
    expect(content).toContain("## Accessibility");
    expect(content).toContain("A red bicycle parked by a brick wall");
    expect(content).not.toContain("instagram.com");

    expect(writes.attaches).toEqual([
      {
        itemId: "Inbox/note.md",
        files: [{ name: `${OK_SHORTCODE}.jpg`, bytes: JPEG }],
      },
    ]);
  });

  it("login_wall fails before any vault write", async () => {
    const writes = emptyWrites();

    const plugin = createInstagramExtractorPlugin({
      getItemById: async () => fakeNote({ body: FAIL_URL }),
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return fakeNote({ body: "" }).item;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.attaches.push({ itemId, files });
        return [];
      },
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: INSTAGRAM_PLUGIN_ID,
          url: FAIL_URL,
          meta: { shortcode: FAIL_SHORTCODE },
        },
      }),
    ).rejects.toThrow(/login_wall/);

    expect(writes.updates).toEqual([]);
    expect(writes.attaches).toEqual([]);
  });

  it("refuses second import when body no longer has the Instagram URL", async () => {
    const writes = emptyWrites();
    let fetchCalls = 0;

    const plugin = createInstagramExtractorPlugin({
      getItemById: async () =>
        fakeNote({
          body: "Already imported caption\n\n# tags\n",
          url: OK_URL,
        }),
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return fakeNote({ body: "" }).item;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.attaches.push({ itemId, files });
        return [];
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("fetch must not run when body has no Instagram URL");
      },
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: INSTAGRAM_PLUGIN_ID,
          url: OK_URL,
          meta: { shortcode: OK_SHORTCODE },
        },
      }),
    ).rejects.toThrow(/no matching Instagram URL in note body/);

    expect(fetchCalls).toBe(0);
    expect(writes.updates).toEqual([]);
    expect(writes.attaches).toEqual([]);
  });

  it("CDN download failure leaves note intact", async () => {
    const writes = emptyWrites();

    const plugin = createInstagramExtractorPlugin({
      getItemById: async () => fakeNote({ body: OK_URL }),
      updateItem: async (itemId, input) => {
        writes.updates.push({ itemId, input });
        return fakeNote({ body: "" }).item;
      },
      attachMediaFiles: async (itemId, files) => {
        writes.attaches.push({ itemId, files });
        return [];
      },
      fetchImpl: createFixtureFetch({ cdn: "fail" }),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: INSTAGRAM_PLUGIN_ID,
          url: OK_URL,
          meta: { shortcode: OK_SHORTCODE },
        },
      }),
    ).rejects.toThrow(/CDN boom/);

    expect(writes.updates).toEqual([]);
    expect(writes.attaches).toEqual([]);
  });
});
