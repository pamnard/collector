import { describe, expect, it, vi } from "vitest";
import type { GetItemResult } from "@collector/api";
import {
  INSTAGRAM_PLUGIN_ID,
  createInstagramExtractorPlugin,
} from "./instagram-extractor-plugin.js";
import type { InstagramFetchSuccess } from "./types.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function fakeNote(input: {
  id?: string;
  body: string;
  url?: string | null;
}): GetItemResult {
  const id = input.id ?? "Inbox/note.md";
  return {
    item: {
      id,
      vault_id: "vault-1",
      title: "Capture",
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

function fetchSuccess(
  overrides: Partial<InstagramFetchSuccess> = {},
): InstagramFetchSuccess {
  return {
    sourceUrl: "https://www.instagram.com/p/AbC123/",
    shortcode: "AbC123",
    authorUsername: "photog",
    caption: "First line title\nSecond line",
    accessibilityCaption: null,
    media: [
      {
        kind: "image",
        url: "https://cdn.instagram.com/t/a.jpg",
        suggestedFilename: "shot.jpg",
      },
    ],
    ...overrides,
  };
}

describe("createInstagramExtractorPlugin (#318)", () => {
  it("discover maps shortcode into ExtractCandidate.meta", () => {
    const plugin = createInstagramExtractorPlugin({
      getItemById: vi.fn(),
      updateItem: vi.fn(),
      attachMediaFiles: vi.fn(),
    });

    const candidates = plugin.discover({
      body: "see https://www.instagram.com/p/AbC123/ here",
    });
    expect(candidates).toEqual([
      {
        extractorId: INSTAGRAM_PLUGIN_ID,
        url: "https://www.instagram.com/p/AbC123/",
        meta: { shortcode: "AbC123" },
      },
    ]);
  });

  it("extract writes title/body/url and attaches media after CDN download", async () => {
    const updateItem = vi.fn(async () => fakeNote({ body: "" }).item);
    const attachMediaFiles = vi.fn(async () => []);
    const fetchInstagramMediaImpl = vi.fn(async () => ({
      ok: true as const,
      value: fetchSuccess(),
    }));
    const fetchExtractMediaBytesImpl = vi.fn(async () => JPEG);

    const plugin = createInstagramExtractorPlugin({
      getItemById: async () =>
        fakeNote({
          body: "Keep me\n\nhttps://www.instagram.com/p/AbC123/\n",
        }),
      updateItem,
      attachMediaFiles,
      fetchInstagramMediaImpl,
      fetchExtractMediaBytesImpl,
    });

    await plugin.extract({
      itemId: "Inbox/note.md",
      candidate: {
        extractorId: INSTAGRAM_PLUGIN_ID,
        url: "https://www.instagram.com/p/AbC123/",
        meta: { shortcode: "AbC123" },
      },
    });

    expect(fetchInstagramMediaImpl).toHaveBeenCalledWith(
      "https://www.instagram.com/p/AbC123/",
      expect.not.objectContaining({ cookies: expect.anything() }),
    );
    expect(fetchExtractMediaBytesImpl).toHaveBeenCalledWith(
      "https://cdn.instagram.com/t/a.jpg",
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.instagram.com/",
        }),
      }),
    );
    expect(updateItem).toHaveBeenCalledWith("Inbox/note.md", {
      title: "First line title",
      content: expect.stringContaining("First line title"),
      url: "https://www.instagram.com/p/AbC123/",
      content_type: "note",
    });
    const updateArg = updateItem.mock.calls[0]![1];
    expect(updateArg.content).toContain("Keep me");
    expect(updateArg.content).not.toContain("instagram.com");
    expect(attachMediaFiles).toHaveBeenCalledWith("Inbox/note.md", [
      { name: "shot.jpg", bytes: JPEG },
    ]);
  });

  it("login_wall fails before any vault write", async () => {
    const updateItem = vi.fn();
    const attachMediaFiles = vi.fn();
    const fetchExtractMediaBytesImpl = vi.fn();

    const plugin = createInstagramExtractorPlugin({
      getItemById: vi.fn(),
      updateItem,
      attachMediaFiles,
      fetchInstagramMediaImpl: async () => ({
        ok: false,
        code: "login_wall",
        message: "login required",
      }),
      fetchExtractMediaBytesImpl,
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: INSTAGRAM_PLUGIN_ID,
          url: "https://www.instagram.com/p/AbC123/",
        },
      }),
    ).rejects.toThrow(/login_wall/);

    expect(updateItem).not.toHaveBeenCalled();
    expect(attachMediaFiles).not.toHaveBeenCalled();
    expect(fetchExtractMediaBytesImpl).not.toHaveBeenCalled();
  });

  it("CDN download failure leaves note intact", async () => {
    const updateItem = vi.fn();
    const attachMediaFiles = vi.fn();

    const plugin = createInstagramExtractorPlugin({
      getItemById: async () =>
        fakeNote({ body: "https://www.instagram.com/p/AbC123/" }),
      updateItem,
      attachMediaFiles,
      fetchInstagramMediaImpl: async () => ({
        ok: true,
        value: fetchSuccess(),
      }),
      fetchExtractMediaBytesImpl: async () => {
        throw new Error("CDN boom");
      },
    });

    await expect(
      plugin.extract({
        itemId: "Inbox/note.md",
        candidate: {
          extractorId: INSTAGRAM_PLUGIN_ID,
          url: "https://www.instagram.com/p/AbC123/",
        },
      }),
    ).rejects.toThrow(/CDN boom/);

    expect(updateItem).not.toHaveBeenCalled();
    expect(attachMediaFiles).not.toHaveBeenCalled();
  });
});
