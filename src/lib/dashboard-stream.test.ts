import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import {
  applyDashboardIndexPage,
  runDashboardLoadMore,
  streamDashboardSlice,
} from "./dashboard-stream.ts";

function stubItem(id: string): ItemFile {
  return {
    id,
    title: id,
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: null,
  } as ItemFile;
}

async function* hydrateOf(
  items: ItemFile[],
): AsyncIterable<ItemFile> {
  for (const item of items) {
    yield item;
  }
}

describe("streamDashboardSlice", () => {
  it("no-ops for stale requestVersion without aborting", async () => {
    let aborted = false;
    let merged = 0;
    await streamDashboardSlice({
      ids: ["a"],
      offset: 0,
      limit: 1,
      requestVersion: 1,
      getRequestVersion: () => 2,
      abortCurrentStream: () => {
        aborted = true;
      },
      beginStream: () => new AbortController(),
      hydrate: async function* () {
        yield stubItem("a");
      },
      mergeItems: () => {
        merged += 1;
      },
    });
    assert.equal(aborted, false);
    assert.equal(merged, 0);
  });

  it("hydrates slice and merges pending bodies", async () => {
    const item = stubItem("a");
    let merged: Map<string, ItemFile> | null = null;
    let controllers: AbortController[] = [];
    await streamDashboardSlice({
      ids: ["a", "b"],
      offset: 0,
      limit: 1,
      requestVersion: 1,
      getRequestVersion: () => 1,
      abortCurrentStream: () => {},
      beginStream: () => {
        const c = new AbortController();
        controllers.push(c);
        return c;
      },
      hydrate: (slice) => {
        assert.deepEqual(slice, ["a"]);
        return hydrateOf([item]);
      },
      mergeItems: (pending) => {
        merged = pending;
      },
    });
    assert.ok(merged);
    assert.equal(merged!.get("a")?.id, "a");
    assert.equal(controllers.length, 1);
  });
});

describe("applyDashboardIndexPage", () => {
  it("clears committed state on empty page", async () => {
    let cleared = false;
    let total = -1;
    await applyDashboardIndexPage(
      { itemIds: [], stamps: [], totalCount: 0, offset: 0 },
      1,
      {
        prefetchSize: 40,
        getRequestVersion: () => 1,
        getPreviousIds: () => ["x"],
        getPreviousStreamEnd: () => 1,
        itemsByIdHas: () => false,
        cachedStampFor: () => undefined,
        getItemIds: () => ["x"],
        getItemsById: () => new Map([["x", stubItem("x")]]),
        getStreamEnd: () => 1,
        setTotalCount: (n) => {
          total = n;
        },
        setLoadedItemIds: () => {},
        setBodyStamps: () => {},
        setStreamWindowEnd: () => {},
        clearCommittedEmpty: () => {
          cleared = true;
        },
        replaceWorkingBodiesKeeping: () => {},
        intersectCommittedWithPage: () => {},
        streamSlice: async () => {
          throw new Error("should not stream empty");
        },
      },
    );
    assert.equal(total, 0);
    assert.equal(cleared, true);
  });

  it("retries stream once when prefetch window incomplete", async () => {
    let streamCalls = 0;
    const bodies = new Map<string, ItemFile>();
    await applyDashboardIndexPage(
      {
        itemIds: ["a", "b"],
        stamps: ["sa", "sb"],
        totalCount: 2,
        offset: 0,
      },
      1,
      {
        prefetchSize: 40,
        getRequestVersion: () => 1,
        getPreviousIds: () => [],
        getPreviousStreamEnd: () => 0,
        itemsByIdHas: (id) => bodies.has(id),
        cachedStampFor: () => undefined,
        getItemIds: () => ["a", "b"],
        getItemsById: () => bodies,
        getStreamEnd: () => 2,
        setTotalCount: () => {},
        setLoadedItemIds: () => {},
        setBodyStamps: () => {},
        setStreamWindowEnd: () => {},
        clearCommittedEmpty: () => {},
        replaceWorkingBodiesKeeping: () => {},
        intersectCommittedWithPage: () => {},
        streamSlice: async () => {
          streamCalls += 1;
          if (streamCalls === 1) {
            // leave incomplete
            return;
          }
          bodies.set("a", stubItem("a"));
          bodies.set("b", stubItem("b"));
        },
      },
    );
    assert.equal(streamCalls, 2);
  });
});

describe("runDashboardLoadMore", () => {
  it("noops when plan is noop", async () => {
    let streamed = false;
    await runDashboardLoadMore({
      isLoading: true,
      isLoadingMore: false,
      streamEndOffset: 0,
      loadedCount: 0,
      totalCount: 10,
      prefetchSize: 40,
      getRequestVersion: () => 1,
      getItemIds: () => [],
      setIsLoadingMore: () => {},
      setStreamWindowEnd: () => {},
      setLoadedItemIds: () => {},
      setTotalCount: () => {},
      setError: () => {},
      streamSlice: async () => {
        streamed = true;
      },
      fetchMoreIds: async () => {
        throw new Error("should not fetch");
      },
      reportError: () => {},
    });
    assert.equal(streamed, false);
  });

  it("streams next window for stream-only plan", async () => {
    const ids = ["a", "b", "c", "d"];
    let streamed: { offset: number; limit: number } | null = null;
    let end = 2;
    await runDashboardLoadMore({
      isLoading: false,
      isLoadingMore: false,
      streamEndOffset: 2,
      loadedCount: 4,
      totalCount: 4,
      prefetchSize: 2,
      getRequestVersion: () => 1,
      getItemIds: () => ids,
      setIsLoadingMore: () => {},
      setStreamWindowEnd: (n) => {
        end = n;
      },
      setLoadedItemIds: () => {},
      setTotalCount: () => {},
      setError: () => {},
      streamSlice: async (_ids, offset, limit) => {
        streamed = { offset, limit };
      },
      fetchMoreIds: async () => {
        throw new Error("should not fetch");
      },
      reportError: () => {},
    });
    assert.deepEqual(streamed, { offset: 2, limit: 2 });
    assert.equal(end, 4);
  });
});
