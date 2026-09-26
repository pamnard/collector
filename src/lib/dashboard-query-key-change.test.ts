import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import { emptyCoverMaps } from "./cover-maps.ts";
import type { DashboardQueryCacheEntry } from "../services/dashboard-query-cache.ts";
import { applyDashboardQueryKeyChange } from "./dashboard-query-key-change.ts";

function stubEntry(
  overrides: Partial<DashboardQueryCacheEntry> = {},
): DashboardQueryCacheEntry {
  const item = {
    id: "a",
    title: "a",
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: null,
  } as ItemFile;
  return {
    itemIds: ["a"],
    itemsById: new Map([["a", item]]),
    bodyStamps: new Map([["a", "s"]]),
    streamEndOffset: 1,
    totalCount: 1,
    covers: emptyCoverMaps(),
    updatedAt: 1,
    ...overrides,
  };
}

type SinkLog = {
  calls: string[];
  applied: DashboardQueryCacheEntry[];
  errors: Array<string | null>;
  loading: boolean[];
};

function createSinks(): {
  log: SinkLog;
  sinks: Parameters<typeof applyDashboardQueryKeyChange>[0]["sinks"];
} {
  const log: SinkLog = {
    calls: [],
    applied: [],
    errors: [],
    loading: [],
  };
  return {
    log,
    sinks: {
      abortCoverFlight() {
        log.calls.push("abortCover");
      },
      setError(message) {
        log.calls.push("setError");
        log.errors.push(message);
      },
      applyCacheEntryToState(entry) {
        log.calls.push("applyCache");
        log.applied.push(entry);
      },
      setIsLoading(loading) {
        log.calls.push("setLoading");
        log.loading.push(loading);
      },
      clearWorkingWindow() {
        log.calls.push("clearWorking");
      },
      clearCommittedPaint() {
        log.calls.push("clearCommitted");
      },
    },
  };
}

describe("applyDashboardQueryKeyChange (#929)", () => {
  it("returns unchanged when keys match and does not touch sinks", () => {
    const { log, sinks } = createSinks();
    const result = applyDashboardQueryKeyChange({
      prevQueryKey: "k1",
      nextQueryKey: "k1",
      prevCommittedCount: 2,
      vaultId: "vault",
      getCached: () => null,
      setCached: () => {},
      peekWarmSnapshot: () => null,
      snapshotToEntry: () => stubEntry(),
      sinks,
    });
    assert.equal(result.kind, "unchanged");
    assert.deepEqual(log.calls, []);
  });

  it("warms from cache and skips cold clear", () => {
    const { log, sinks } = createSinks();
    const entry = stubEntry();
    const result = applyDashboardQueryKeyChange({
      prevQueryKey: "k1",
      nextQueryKey: "k2",
      prevCommittedCount: 3,
      vaultId: "vault",
      getCached: (key) => (key === "k2" ? entry : null),
      setCached: () => {},
      peekWarmSnapshot: () => null,
      snapshotToEntry: () => stubEntry(),
      sinks,
    });
    assert.equal(result.kind, "warm");
    assert.deepEqual(log.calls, [
      "abortCover",
      "setError",
      "applyCache",
      "setLoading",
    ]);
    assert.equal(log.loading.at(-1), false);
    assert.equal(log.applied[0], entry);
  });

  it("cold path clears working and committed only when prevCommitted is 0", () => {
    const { log, sinks } = createSinks();
    const result = applyDashboardQueryKeyChange({
      prevQueryKey: "k1",
      nextQueryKey: "k2",
      prevCommittedCount: 0,
      vaultId: null,
      getCached: () => null,
      setCached: () => {},
      peekWarmSnapshot: () => null,
      snapshotToEntry: () => stubEntry(),
      sinks,
    });
    assert.equal(result.kind, "cold");
    assert.deepEqual(log.calls, [
      "abortCover",
      "setError",
      "clearWorking",
      "clearCommitted",
      "setLoading",
    ]);
    assert.equal(log.loading.at(-1), true);
  });

  it("cold path keeps committed paint when prevCommitted > 0", () => {
    const { log, sinks } = createSinks();
    const result = applyDashboardQueryKeyChange({
      prevQueryKey: "k1",
      nextQueryKey: "k2",
      prevCommittedCount: 4,
      vaultId: null,
      getCached: () => null,
      setCached: () => {},
      peekWarmSnapshot: () => null,
      snapshotToEntry: () => stubEntry(),
      sinks,
    });
    assert.equal(result.kind, "cold");
    assert.ok(!log.calls.includes("clearCommitted"));
    assert.ok(log.calls.includes("clearWorking"));
  });

  it("warms from session snapshot when cache miss", () => {
    const { log, sinks } = createSinks();
    const entry = stubEntry({ totalCount: 9 });
    let cached: DashboardQueryCacheEntry | null = null;
    const result = applyDashboardQueryKeyChange({
      prevQueryKey: "k1",
      nextQueryKey: "k2",
      prevCommittedCount: 1,
      vaultId: "vault",
      getCached: () => cached,
      setCached: (_key, next) => {
        cached = next;
      },
      peekWarmSnapshot: () => ({ warm: true }),
      snapshotToEntry: () => entry,
      sinks,
    });
    assert.equal(result.kind, "warm");
    assert.ok(log.calls.includes("applyCache"));
    assert.equal(log.loading.at(-1), false);
  });
});
