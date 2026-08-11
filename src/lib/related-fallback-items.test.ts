import { describe, expect, it, vi } from "vitest";
import type { ItemFile } from "@collector/shared";
import {
  collectRelatedFallbackIds,
  loadRelatedFallbackTeasers,
  relatedFolderPathChain,
  relatedTeaserFromItem,
} from "./related-fallback-items";
import { RELATED_PANEL_SIZE } from "./related-teaser";

describe("relatedFolderPathChain", () => {
  it("walks leaf to root including empty root", () => {
    expect(relatedFolderPathChain("A/B/C")).toEqual(["A/B/C", "A/B", "A", ""]);
    expect(relatedFolderPathChain("Inbox")).toEqual(["Inbox", ""]);
    expect(relatedFolderPathChain("")).toEqual([""]);
  });
});

describe("collectRelatedFallbackIds", () => {
  it("fills from the same folder excluding self", async () => {
    const list = vi.fn(async (folderPath: string, limit: number) => {
      expect(folderPath).toBe("Design");
      expect(limit).toBe(4);
      return ["Design/self.md", "Design/a.md", "Design/b.md", "Design/c.md"];
    });
    const ids = await collectRelatedFallbackIds({
      currentItemId: "Design/self.md",
      startFolderPath: "Design",
      size: 3,
      listFolderItemIds: list,
    });
    expect(ids).toEqual(["Design/a.md", "Design/b.md", "Design/c.md"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("walks parents when the leaf folder is short", async () => {
    const list = vi.fn(async (folderPath: string, _limit: number) => {
      if (folderPath === "A/B") {
        return ["A/B/self.md", "A/B/one.md"];
      }
      if (folderPath === "A") {
        return ["A/two.md", "A/three.md", "A/four.md"];
      }
      return [];
    });
    const ids = await collectRelatedFallbackIds({
      currentItemId: "A/B/self.md",
      startFolderPath: "A/B",
      size: 4,
      listFolderItemIds: list,
    });
    expect(ids).toEqual([
      "A/B/one.md",
      "A/two.md",
      "A/three.md",
      "A/four.md",
    ]);
    expect(list.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["A/B", 5],
      ["A", 4],
    ]);
  });

  it("returns null when root still cannot fill size", async () => {
    const list = vi.fn(async (folderPath: string, _limit: number) => {
      if (folderPath === "Solo") {
        return ["Solo/self.md", "Solo/only.md"];
      }
      if (folderPath === "") {
        return ["Solo/self.md", "Solo/only.md", "root-extra.md"];
      }
      return [];
    });
    const ids = await collectRelatedFallbackIds({
      currentItemId: "Solo/self.md",
      startFolderPath: "Solo",
      size: RELATED_PANEL_SIZE,
      listFolderItemIds: list,
    });
    expect(ids).toBeNull();
  });

  it("dedupes ids seen in a parent after collecting from a child", async () => {
    const list = vi.fn(async (folderPath: string, _limit: number) => {
      if (folderPath === "A/B") {
        return ["A/B/self.md", "A/B/one.md"];
      }
      if (folderPath === "A") {
        return ["A/B/one.md", "A/two.md", "A/three.md"];
      }
      return [];
    });
    const ids = await collectRelatedFallbackIds({
      currentItemId: "A/B/self.md",
      startFolderPath: "A/B",
      size: 3,
      listFolderItemIds: list,
    });
    expect(ids).toEqual(["A/B/one.md", "A/two.md", "A/three.md"]);
  });

  it("returns null when aborted between folder levels", async () => {
    const controller = new AbortController();
    const list = vi.fn(async (folderPath: string, _limit: number) => {
      if (folderPath === "A/B") {
        controller.abort();
        return ["A/B/self.md", "A/B/one.md"];
      }
      return ["A/two.md", "A/three.md", "A/four.md", "A/five.md"];
    });
    const ids = await collectRelatedFallbackIds({
      currentItemId: "A/B/self.md",
      startFolderPath: "A/B",
      size: 4,
      signal: controller.signal,
      listFolderItemIds: list,
    });
    expect(ids).toBeNull();
    expect(list.mock.calls.map((c) => c[0])).toEqual(["A/B"]);
  });
});

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

  it("passes description/date/type/form through with a resolved cover", () => {
    const item = {
      id: "y.md",
      title: "Y",
      description: "Lead text",
      content_type: "article",
      created_at: "2015-06-01T00:00:00.000Z",
      thumbnail: null,
    } as ItemFile;
    expect(
      relatedTeaserFromItem(item, "https://host/media/y.webp", "portrait"),
    ).toEqual({
      id: "y.md",
      title: "Y",
      thumbnail: "https://host/media/y.webp",
      imageForm: "portrait",
      description: "Lead text",
      createdAt: "2015-06-01T00:00:00.000Z",
      contentType: "article",
    });
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

describe("loadRelatedFallbackTeasers", () => {
  it("hydrates ids in order, probes cover form, or null on missing body", async () => {
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

    const probe = vi.fn(async (src: string) => {
      expect(src).toBe("https://host/media/a.webp");
      return "portrait" as const;
    });

    const ok = await loadRelatedFallbackTeasers({
      currentItemId: "self.md",
      startFolderPath: "",
      size: 2,
      queryFolderIds: async () => ["self.md", "a.md", "b.md"],
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

    const bad = await loadRelatedFallbackTeasers({
      currentItemId: "self.md",
      startFolderPath: "",
      size: 2,
      queryFolderIds: async () => ["self.md", "a.md", "missing.md"],
      hydrate,
      resolveThumbnailPaths: async () => new Map(),
      probeCoverImageForm: async () => null,
    });
    expect(bad).toBeNull();
  });
});
