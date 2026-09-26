import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import type { IndexQueryResult } from "@collector/api";
import { emptyCoverMaps } from "./cover-maps.ts";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import {
  cleanupDashboardIndexQueryWindow,
  prepareDashboardIndexQueryWindow,
  runDashboardIndexQueryWindow,
  runDashboardSyncRepublish,
} from "./dashboard-index-query-run.ts";

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

function stubEntry(): DashboardQueryCacheEntry {
  const item = stubItem("a");
  return {
    itemIds: ["a"],
    itemsById: new Map([["a", item]]),
    bodyStamps: new Map([["a", "s"]]),
    streamEndOffset: 1,
    totalCount: 1,
    covers: emptyCoverMaps(),
    updatedAt: 1,
  };
}

describe("prepareDashboardIndexQueryWindow (#929)", () => {
  it("applies cache hit and aborts flights", () => {
    const calls: string[] = [];
    const entry = stubEntry();
    const result = prepareDashboardIndexQueryWindow({
      queryKey: "k",
      getCached: () => entry,
      sinks: {
        setError: () => calls.push("setError"),
        setLoadedItemIds: (ids) => {
          calls.push(`ids:${ids.join(",")}`);
        },
        setItemsById: () => calls.push("setItems"),
        setTotalCount: (t) => calls.push(`total:${t}`),
        setStreamWindowEnd: (e) => calls.push(`end:${e}`),
        setIsLoading: (v) => calls.push(`loading:${v}`),
        syncWorkingRefs: () => calls.push("syncRefs"),
        clearWorkingBodies: () => calls.push("clearBodies"),
        getCommittedCount: () => 2,
        abortStream: () => calls.push("abortStream"),
        abortCoverFlight: () => calls.push("abortCover"),
      },
    });
    assert.equal(result.hadCacheHit, true);
    assert.ok(calls.includes("ids:a"));
    assert.ok(calls.includes("loading:false"));
    assert.ok(calls.includes("abortStream"));
    assert.ok(!calls.includes("clearBodies"));
  });

  it("cold miss with empty committed clears window", () => {
    const calls: string[] = [];
    const result = prepareDashboardIndexQueryWindow({
      queryKey: "k",
      getCached: () => null,
      sinks: {
        setError: () => calls.push("setError"),
        setLoadedItemIds: (ids) => calls.push(`ids:${ids.length}`),
        setItemsById: () => calls.push("setItems"),
        setTotalCount: (t) => calls.push(`total:${t}`),
        setStreamWindowEnd: (e) => calls.push(`end:${e}`),
        setIsLoading: (v) => calls.push(`loading:${v}`),
        syncWorkingRefs: (w) => calls.push(`syncTotal:${w.totalCount}`),
        clearWorkingBodies: () => calls.push("clearBodies"),
        getCommittedCount: () => 0,
        abortStream: () => calls.push("abortStream"),
        abortCoverFlight: () => calls.push("abortCover"),
      },
    });
    assert.equal(result.hadCacheHit, false);
    assert.ok(calls.includes("clearBodies"));
    assert.ok(calls.includes("loading:true"));
    assert.ok(calls.includes("ids:0"));
    assert.ok(calls.includes("total:0"));
  });

  it("cold miss with held committed does not wipe ids", () => {
    const calls: string[] = [];
    prepareDashboardIndexQueryWindow({
      queryKey: "k",
      getCached: () => null,
      sinks: {
        setError: () => {},
        setLoadedItemIds: () => calls.push("setIds"),
        setItemsById: () => calls.push("setItems"),
        setTotalCount: () => calls.push("setTotal"),
        setStreamWindowEnd: () => calls.push("setEnd"),
        setIsLoading: () => calls.push("setLoading"),
        syncWorkingRefs: () => calls.push("sync"),
        clearWorkingBodies: () => calls.push("clearBodies"),
        getCommittedCount: () => 5,
        abortStream: () => {},
        abortCoverFlight: () => {},
      },
    });
    assert.deepEqual(calls, ["clearBodies", "setItems"]);
  });
});

describe("runDashboardIndexQueryWindow (#929)", () => {
  it("applies page and commits on success", async () => {
    const calls: string[] = [];
    let version = 1;
    const controller = new AbortController();
    await runDashboardIndexQueryWindow({
      requestVersion: 1,
      signal: controller.signal,
      filter: "all",
      searchQuery: "",
      sort: { key: "updated_at", dir: "desc" },
      prefetchSize: 40,
      getRequestVersion: () => version,
      queryIndex: async () =>
        ({
          ids: ["a"],
          stamps: ["s"],
          total: 1,
          offset: 0,
        }) satisfies IndexQueryResult,
      applyIndexPage: async (page, rv) => {
        calls.push(`apply:${page.itemIds.join(",")}:${rv}`);
      },
      commitWorkingToDisplay: async (rv, opts) => {
        calls.push(`commit:${rv}:${opts.blockOnCovers}`);
      },
      setError: () => calls.push("error"),
      setIsLoading: (v) => calls.push(`loading:${v}`),
      setQueryBusy: (v) => calls.push(`busy:${v}`),
      reportError: () => calls.push("report"),
    });
    assert.deepEqual(calls, [
      "apply:a:1",
      "commit:1:true",
      "loading:false",
      "busy:false",
    ]);
  });

  it("skips work when aborted before query returns", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    controller.abort();
    await runDashboardIndexQueryWindow({
      requestVersion: 1,
      signal: controller.signal,
      filter: "all",
      searchQuery: "",
      sort: { key: "updated_at", dir: "desc" },
      prefetchSize: 40,
      getRequestVersion: () => 1,
      queryIndex: async () => {
        calls.push("query");
        return { ids: [], stamps: [], total: 0, offset: 0 };
      },
      applyIndexPage: async () => {
        calls.push("apply");
      },
      commitWorkingToDisplay: async () => {
        calls.push("commit");
      },
      setError: () => {},
      setIsLoading: () => {},
      setQueryBusy: () => {},
      reportError: () => {},
    });
    assert.deepEqual(calls, []);
  });

  it("reports error and clears busy on query failure", async () => {
    const calls: string[] = [];
    await runDashboardIndexQueryWindow({
      requestVersion: 1,
      signal: new AbortController().signal,
      filter: "all",
      searchQuery: "",
      sort: { key: "updated_at", dir: "desc" },
      prefetchSize: 40,
      getRequestVersion: () => 1,
      queryIndex: async () => {
        throw new Error("boom");
      },
      applyIndexPage: async () => {},
      commitWorkingToDisplay: async () => {},
      setError: (m) => calls.push(`err:${m}`),
      setIsLoading: (v) => calls.push(`loading:${v}`),
      setQueryBusy: (v) => calls.push(`busy:${v}`),
      reportError: (label) => calls.push(`report:${label}`),
    });
    assert.deepEqual(calls, [
      "report:dashboard index page",
      "err:boom",
      "loading:false",
      "busy:false",
    ]);
  });

  it("skips apply when requestVersion advanced during query", async () => {
    const calls: string[] = [];
    let version = 1;
    await runDashboardIndexQueryWindow({
      requestVersion: 1,
      signal: new AbortController().signal,
      filter: "all",
      searchQuery: "",
      sort: { key: "updated_at", dir: "desc" },
      prefetchSize: 40,
      getRequestVersion: () => version,
      queryIndex: async () => {
        version = 2;
        return { ids: ["a"], stamps: ["s"], total: 1, offset: 0 };
      },
      applyIndexPage: async () => {
        calls.push("apply");
      },
      commitWorkingToDisplay: async () => {
        calls.push("commit");
      },
      setError: () => {},
      setIsLoading: () => {},
      setQueryBusy: () => {},
      reportError: () => {},
    });
    assert.deepEqual(calls, []);
  });
});

describe("runDashboardSyncRepublish (#929)", () => {
  it("queries with max(loaded, prefetch) and commits without blocking covers", async () => {
    const calls: string[] = [];
    await runDashboardSyncRepublish({
      requestVersion: 3,
      getRequestVersion: () => 3,
      getItemIdsLength: () => 80,
      prefetchSize: 40,
      getFilter: () => "all",
      getSearchQuery: () => "q",
      getSort: () => ({ key: "updated_at", dir: "desc" }),
      queryIndex: async (_f, search, range) => {
        calls.push(`q:${search}:${range.limit}`);
        return { ids: ["a"], stamps: ["s"], total: 1, offset: 0 };
      },
      applyIndexPage: async () => {
        calls.push("apply");
      },
      commitWorkingToDisplay: async (_rv, opts) => {
        calls.push(`commit:${opts.blockOnCovers}`);
      },
      reportError: () => {},
    });
    assert.deepEqual(calls, ["q:q:80", "apply", "commit:false"]);
  });
});

describe("cleanupDashboardIndexQueryWindow (#929)", () => {
  it("aborts and clears busy only for matching requestVersion", () => {
    const calls: string[] = [];
    const controller = new AbortController();
    cleanupDashboardIndexQueryWindow({
      requestVersion: 2,
      getRequestVersion: () => 2,
      abortController: controller,
      abortStream: () => calls.push("stream"),
      abortCoverFlight: () => calls.push("cover"),
      setQueryBusy: (v) => calls.push(`busy:${v}`),
    });
    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(calls, ["stream", "cover", "busy:false"]);
  });

  it("does not clear busy when version advanced", () => {
    const calls: string[] = [];
    cleanupDashboardIndexQueryWindow({
      requestVersion: 1,
      getRequestVersion: () => 2,
      abortController: new AbortController(),
      abortStream: () => calls.push("stream"),
      abortCoverFlight: () => calls.push("cover"),
      setQueryBusy: () => calls.push("busy"),
    });
    assert.deepEqual(calls, ["stream", "cover"]);
  });
});
