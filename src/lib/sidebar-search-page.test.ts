import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEARCH_PAGE_SIZE } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  SIDEBAR_SEARCH_PAGE_SIZE,
  fetchSidebarSearchPage,
  nextSidebarSearchPage,
  sidebarSearchHasMore,
  sidebarSearchMountedRowCap,
} from "./sidebar-search-page.ts";

function stubItem(id: string): ItemFile {
  return { id, title: id } as ItemFile;
}

describe("SIDEBAR_SEARCH_PAGE_SIZE", () => {
  it("aliases SEARCH_PAGE_SIZE instead of a duplicated literal", () => {
    assert.equal(SIDEBAR_SEARCH_PAGE_SIZE, SEARCH_PAGE_SIZE);
  });
});

describe("sidebarSearchMountedRowCap", () => {
  it("allows at most one page before any load more", () => {
    assert.equal(sidebarSearchMountedRowCap(1), SIDEBAR_SEARCH_PAGE_SIZE);
    assert.equal(sidebarSearchMountedRowCap(1, 20), 20);
  });

  it("grows only with explicit additional pages", () => {
    assert.equal(sidebarSearchMountedRowCap(2, 20), 40);
    assert.equal(sidebarSearchMountedRowCap(3, 20), 60);
  });
});

describe("sidebarSearchHasMore / nextSidebarSearchPage", () => {
  it("reports more when loaded count is below total", () => {
    assert.equal(sidebarSearchHasMore(20, 100), true);
    assert.equal(sidebarSearchHasMore(100, 100), false);
  });

  it("builds the next page from the loaded window", () => {
    assert.deepEqual(nextSidebarSearchPage(0, 20), { limit: 20, offset: 0 });
    assert.deepEqual(nextSidebarSearchPage(20, 20), { limit: 20, offset: 20 });
  });
});

describe("fetchSidebarSearchPage", () => {
  it("hydrates only the page-sized id window from queryIndex (#658)", async () => {
    const allIds = Array.from({ length: 100 }, (_, i) => `item-${i}.md`);
    let hydratedIds: string[] = [];

    const items = {
      queryIndex: async (
        _filter: "all",
        _query: string | undefined,
        page: { limit: number; offset: number },
      ) => {
        const ids = allIds.slice(page.offset, page.offset + page.limit);
        return {
          ids,
          stamps: ids.map((_, i) => String(i)),
          total: allIds.length,
          offset: page.offset,
        };
      },
      hydrate: async function* (ids: string[]) {
        hydratedIds = [...ids];
        for (const id of ids) {
          yield stubItem(id);
        }
      },
    };

    const page = nextSidebarSearchPage(0, 20);
    const result = await fetchSidebarSearchPage(items, "hello", page);

    assert.equal(result.items.length, 20);
    assert.equal(result.totalCount, 100);
    assert.equal(result.fetchedIdCount, 20);
    assert.equal(hydratedIds.length, 20);
    assert.ok(result.items.length <= sidebarSearchMountedRowCap(1, 20));
    assert.deepEqual(
      result.items.map((item) => item.id),
      allIds.slice(0, 20),
    );
  });

  it("rejects an oversized index page instead of mounting it", async () => {
    const items = {
      queryIndex: async () => ({
        ids: Array.from({ length: 5 }, (_, i) => `${i}.md`),
        stamps: ["1", "2", "3", "4", "5"],
        total: 5,
        offset: 0,
      }),
      hydrate: async function* () {
        // should not run
      },
    };

    await assert.rejects(
      () => fetchSidebarSearchPage(items, "q", { limit: 2, offset: 0 }),
      /exceeded limit/,
    );
  });
});
