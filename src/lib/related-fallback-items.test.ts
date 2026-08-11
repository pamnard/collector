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
  it("maps thumbnail null when missing and passes description/date/type through", () => {
    const item = {
      id: "x.md",
      title: "X",
      description: "",
      content_type: "bookmark",
      created_at: "2020-01-02T03:04:05.000Z",
    } as ItemFile;
    expect(relatedTeaserFromItem(item)).toEqual({
      id: "x.md",
      title: "X",
      thumbnail: null,
      description: "",
      createdAt: "2020-01-02T03:04:05.000Z",
      contentType: "bookmark",
    });
  });

  it("maps thumbnail and non-empty description without inventing values", () => {
    const item = {
      id: "y.md",
      title: "Y",
      description: "Lead text",
      content_type: "article",
      created_at: "2015-06-01T00:00:00.000Z",
      thumbnail: "media/cover.webp",
    } as ItemFile;
    expect(relatedTeaserFromItem(item)).toEqual({
      id: "y.md",
      title: "Y",
      thumbnail: "media/cover.webp",
      description: "Lead text",
      createdAt: "2015-06-01T00:00:00.000Z",
      contentType: "article",
    });
  });
});

describe("loadRelatedFallbackTeasers", () => {
  it("hydrates ids in order or null on missing body", async () => {
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

    const ok = await loadRelatedFallbackTeasers({
      currentItemId: "self.md",
      startFolderPath: "",
      size: 2,
      queryFolderIds: async () => ["self.md", "a.md", "b.md"],
      hydrate,
    });
    expect(ok).toEqual([
      {
        id: "a.md",
        title: "a.md",
        thumbnail: null,
        description: "",
        createdAt: "2020-01-01T00:00:00.000Z",
        contentType: "bookmark",
      },
      {
        id: "b.md",
        title: "b.md",
        thumbnail: null,
        description: "",
        createdAt: "2020-01-01T00:00:00.000Z",
        contentType: "bookmark",
      },
    ]);

    const bad = await loadRelatedFallbackTeasers({
      currentItemId: "self.md",
      startFolderPath: "",
      size: 2,
      queryFolderIds: async () => ["self.md", "a.md", "missing.md"],
      hydrate,
    });
    expect(bad).toBeNull();
  });
});
