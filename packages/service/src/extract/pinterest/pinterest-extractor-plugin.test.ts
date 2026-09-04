/**
 * Pinterest ExtractorPlugin — HTML fixtures + injectable fetch.
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
import {
  PINTEREST_PLUGIN_ID,
  createPinterestExtractorPlugin,
} from "./pinterest-extractor-plugin.js";
import { OFFLINE_PUBLIC_LOOKUP } from "../offline-public-lookup.js";

import { companionBodyUrlKeys } from "../companion-body-url-keys.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const OK_PIN_ID = "111222333444";
const OK_URL = `https://www.pinterest.com/pin/${OK_PIN_ID}/`;
const FAIL_PIN_ID = "999999999999";
const FAIL_URL = `https://www.pinterest.com/pin/${FAIL_PIN_ID}/`;

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function textResponse(
  body: string,
  init: { status?: number } = {},
): Response {
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
  const single = readFixture("single-image-pin.html");
  const wall = readFixture("login-wall.html");
  const cdn = options?.cdn ?? "ok";

  return async (input) => {
    const url = String(input);

    if (url.includes(`/pin/${OK_PIN_ID}/`) && !url.includes("PinResource")) {
      return textResponse(single);
    }
    if (url.includes("cdn.pinterest.fixture/single.jpg")) {
      if (cdn === "fail") {
        throw new Error("CDN boom");
      }
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (url.includes(`/pin/${FAIL_PIN_ID}/`) || url.includes(FAIL_PIN_ID)) {
      return textResponse(wall, { status: 403 });
    }
    throw new Error(
      `unexpected URL in pinterest-extractor-plugin fixture fetch: ${url}`,
    );
  };
}

function unusedVault(): never {
  throw new Error("vault write must not run in this test");
}

describe("createPinterestExtractorPlugin (#34)", () => {
  it("companionBodyUrlKeys strips lone pin.it + full pin pair", () => {
    expect(
      companionBodyUrlKeys(
        [
          { shortcode: "111222333444" },
          { shortcode: "pinit:AbCdEf12" },
        ],
        "111222333444",
        "111222333444",
        "pinit:",
      ).sort(),
    ).toEqual(["111222333444", "pinit:AbCdEf12"]);
  });

  it("discover maps shortcode into ExtractCandidate.meta", () => {
    const plugin = createPinterestExtractorPlugin({
      getItemById: async () => unusedVault(),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
    });

    const candidates = plugin.discover({
      body: `see ${OK_URL} here`,
    });
    expect(candidates).toEqual([
      {
        extractorId: PINTEREST_PLUGIN_ID,
        url: OK_URL,
        meta: { shortcode: OK_PIN_ID },
      },
    ]);
  });

  it("extract parses fixture HTML into title/body/url and attaches CDN bytes", async () => {
    const writes = emptyWrites();
    let note = fakeNote({
      body: `Keep me\n\n${OK_URL}\n`,
    });

    const plugin = createPinterestExtractorPlugin({
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

    const candidates = plugin.discover({ body: note.content ?? "" });
    await plugin.extract({ itemId: note.item.id, candidate: candidates[0]! });

    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]!.input.title).toBe("Morning ride");
    expect(writes.updates[0]!.input.url).toBe(OK_URL);
    expect(writes.updates[0]!.input.content).toContain("Keep me");
    expect(writes.updates[0]!.input.content).not.toContain(OK_URL);
    expect(writes.attaches).toHaveLength(1);
    expect(writes.attaches[0]!.files[0]!.name).toBe(`${OK_PIN_ID}-1.jpg`);
    expect(writes.attaches[0]!.files[0]!.bytes).toEqual(JPEG);
  });

  it("refuses extract when pin URL is no longer in the body", async () => {
    const plugin = createPinterestExtractorPlugin({
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
          extractorId: PINTEREST_PLUGIN_ID,
          url: OK_URL,
          meta: { shortcode: OK_PIN_ID },
        },
      }),
    ).rejects.toThrow(/no matching Pinterest URL/);
  });

  it("does not write the note when CDN download fails", async () => {
    const plugin = createPinterestExtractorPlugin({
      getItemById: async () =>
        fakeNote({ body: `Keep me\n\n${OK_URL}\n` }),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch({ cdn: "fail" }),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: PINTEREST_PLUGIN_ID,
          url: OK_URL,
          meta: { shortcode: OK_PIN_ID },
        },
      }),
    ).rejects.toThrow(/CDN boom/);
  });

  it("fails loudly on login wall without vault writes", async () => {
    const plugin = createPinterestExtractorPlugin({
      getItemById: async () => fakeNote({ body: `${FAIL_URL}\n` }),
      updateItem: async () => unusedVault(),
      attachMediaFiles: async () => unusedVault(),
      fetchImpl: createFixtureFetch(),
      lookupAddresses: OFFLINE_PUBLIC_LOOKUP,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: PINTEREST_PLUGIN_ID,
          url: FAIL_URL,
          meta: { shortcode: FAIL_PIN_ID },
        },
      }),
    ).rejects.toThrow(/Pinterest extract failed/);
  });
});
