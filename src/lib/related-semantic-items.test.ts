import { describe, expect, it, vi } from "vitest";
import type { ItemFile } from "@collector/shared";
import { relatedTeaserFromItem } from "./related-teaser";
import { loadRelatedSemanticTeasers } from "./related-semantic-items";
import {
  COVER_IMAGE_PROBE_TIMEOUT_MS,
  probeCoverImageFormInBrowser,
} from "./teaser-layout/probe-cover-image-form";

describe("relatedTeaserFromItem", () => {
  it("stores a display cover URL and measured form", () => {
    const item = {
      id: "x.md",
      title: "X",
      description: "",
      content_type: "bookmark",
      created_at: "2020-01-02T03:04:05.000Z",
      thumbnail: "fm-ignored.webp",
      url: "https://example.com",
    } as ItemFile;
    expect(relatedTeaserFromItem(item, null, null)).toEqual({
      id: "x.md",
      title: "X",
      thumbnail: null,
      imageForm: null,
      description: "",
      createdAt: "2020-01-02T03:04:05.000Z",
      contentType: "bookmark",
    });
    expect(
      relatedTeaserFromItem(item, "https://host/media/cover.webp", "landscape")
        .thumbnail,
    ).toBe("https://host/media/cover.webp");
  });

  it("rejects imageForm without a resolved cover", () => {
    const item = {
      id: "z.md",
      title: "Z",
      description: "",
      content_type: "bookmark",
      created_at: "2020-01-01T00:00:00.000Z",
      thumbnail: null,
    } as ItemFile;
    expect(() => relatedTeaserFromItem(item, null, "square")).toThrow(
      /imageForm requires/,
    );
  });
});

describe("loadRelatedSemanticTeasers", () => {
  it("returns null when similar hits are empty", async () => {
    const findSimilarItems = vi.fn(async () => []);
    const result = await loadRelatedSemanticTeasers({
      currentItemId: "self.md",
      size: 2,
      findSimilarItems,
      hydrate: async function* () {},
      resolveThumbnailPaths: async () => new Map(),
      probeCoverImageForm: async () => null,
    });
    expect(result).toBeNull();
    expect(findSimilarItems).toHaveBeenCalledWith("self.md", 2);
  });

  it("hydrates hits in score order and probes cover form", async () => {
    async function* hydrate(ids: string[]) {
      for (const id of ids) {
        yield {
          id,
          title: id,
          thumbnail: null,
          description: "",
          content_type: "bookmark",
          created_at: "2020-01-01T00:00:00.000Z",
        } as ItemFile;
      }
    }

    const probe = vi.fn(async (src: string) => {
      expect(src).toBe("https://host/media/a.webp");
      return "portrait" as const;
    });

    const findSimilarItems = vi.fn(async () => [
      { id: "a.md", score: 0.9 },
      { id: "b.md", score: 0.5 },
    ]);

    const ok = await loadRelatedSemanticTeasers({
      currentItemId: "self.md",
      size: 2,
      findSimilarItems,
      hydrate,
      resolveThumbnailPaths: async (items) => {
        const map = new Map<string, string | null>();
        for (const item of items) {
          map.set(
            item.id,
            item.id === "a.md" ? "https://host/media/a.webp" : null,
          );
        }
        return map;
      },
      probeCoverImageForm: probe,
    });

    expect(findSimilarItems).toHaveBeenCalledWith("self.md", 2);
    expect(ok).toEqual([
      {
        id: "a.md",
        title: "a.md",
        thumbnail: "https://host/media/a.webp",
        imageForm: "portrait",
        description: "",
        createdAt: "2020-01-01T00:00:00.000Z",
        contentType: "bookmark",
      },
      {
        id: "b.md",
        title: "b.md",
        thumbnail: null,
        imageForm: null,
        description: "",
        createdAt: "2020-01-01T00:00:00.000Z",
        contentType: "bookmark",
      },
    ]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("returns null when hydrate misses an id", async () => {
    async function* hydrate(ids: string[]) {
      for (const id of ids) {
        if (id === "missing.md") {
          continue;
        }
        yield {
          id,
          title: id,
          thumbnail: null,
          description: "",
          content_type: "bookmark",
          created_at: "2020-01-01T00:00:00.000Z",
        } as ItemFile;
      }
    }

    const bad = await loadRelatedSemanticTeasers({
      currentItemId: "self.md",
      size: 2,
      findSimilarItems: async () => [
        { id: "a.md", score: 0.9 },
        { id: "missing.md", score: 0.4 },
      ],
      hydrate,
      resolveThumbnailPaths: async () => new Map(),
      probeCoverImageForm: async () => null,
    });
    expect(bad).toBeNull();
  });

  it("finishes related load when browser probe times out on a remote cover", async () => {
    vi.useFakeTimers();
    type FakeImage = {
      onload: ((this: FakeImage, ev: Event) => void) | null;
      onerror: ((this: FakeImage, ev: Event) => void) | null;
      src: string;
      naturalWidth: number;
      naturalHeight: number;
    };
    vi.stubGlobal(
      "Image",
      class {
        onload: FakeImage["onload"] = null;
        onerror: FakeImage["onerror"] = null;
        naturalWidth = 0;
        naturalHeight = 0;
        #src = "";
        get src() {
          return this.#src;
        }
        set src(value: string) {
          this.#src = value;
        }
      },
    );

    async function* hydrate(ids: string[]) {
      for (const id of ids) {
        yield {
          id,
          title: id,
          thumbnail: null,
          description: "",
          content_type: "video",
          created_at: "2020-01-01T00:00:00.000Z",
          url: "https://www.youtube.com/watch?v=abcdefghijk",
        } as ItemFile;
      }
    }

    try {
      const loadPromise = loadRelatedSemanticTeasers({
        currentItemId: "self.md",
        size: 1,
        findSimilarItems: async () => [{ id: "yt.md", score: 0.9 }],
        hydrate,
        resolveThumbnailPaths: async () => new Map([["yt.md", null]]),
        probeCoverImageForm: probeCoverImageFormInBrowser,
      });
      await vi.advanceTimersByTimeAsync(COVER_IMAGE_PROBE_TIMEOUT_MS);
      const ok = await loadPromise;
      expect(ok).toEqual([
        {
          id: "yt.md",
          title: "yt.md",
          thumbnail: "https://img.youtube.com/vi/abcdefghijk/mqdefault.jpg",
          imageForm: null,
          description: "",
          createdAt: "2020-01-01T00:00:00.000Z",
          contentType: "video",
        },
      ]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("returns null when aborted after similar lookup", async () => {
    const controller = new AbortController();
    const result = await loadRelatedSemanticTeasers({
      currentItemId: "self.md",
      size: 2,
      findSimilarItems: async () => {
        controller.abort();
        return [
          { id: "a.md", score: 0.9 },
          { id: "b.md", score: 0.5 },
        ];
      },
      hydrate: async function* () {
        throw new Error("hydrate must not run after abort");
      },
      resolveThumbnailPaths: async () => new Map(),
      probeCoverImageForm: async () => null,
      signal: controller.signal,
    });
    expect(result).toBeNull();
  });
});
