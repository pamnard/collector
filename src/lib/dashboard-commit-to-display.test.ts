import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import { emptyCoverMaps, itemCoverStamp, type CoverMaps } from "./cover-maps.ts";
import { runDashboardCommitToDisplay } from "./dashboard-commit-to-display.ts";

function stubItem(
  id: string,
  overrides: Partial<ItemFile> = {},
): ItemFile {
  return {
    id,
    title: id,
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: null,
    ...overrides,
  } as ItemFile;
}

function mapsResolvedFor(items: ItemFile[]): CoverMaps {
  const paths = new Map<string, string | null>();
  const stamps = new Map<string, string>();
  const sizes = new Map<string, { width: number; height: number } | null>();
  for (const item of items) {
    paths.set(item.id, null);
    stamps.set(item.id, itemCoverStamp(item));
    sizes.set(item.id, null);
  }
  return { paths, stamps, sizes };
}

type SinkLog = {
  calls: string[];
  immediate: Array<{ ids: string[]; nextTotal: number; hasMore: boolean }>;
  held: Array<{ ids: string[]; nextTotal: number; hasMore: boolean }>;
  refs: Array<{ ids: string[]; nextTotal: number }>;
  bodyStampKeys: string[][];
  cacheWrites: number;
  heldErrors: unknown[];
};

function createSink(): {
  log: SinkLog;
  sink: Parameters<typeof runDashboardCommitToDisplay>[0]["sink"];
} {
  const log: SinkLog = {
    calls: [],
    immediate: [],
    held: [],
    refs: [],
    bodyStampKeys: [],
    cacheWrites: 0,
    heldErrors: [],
  };
  return {
    log,
    sink: {
      applyImmediateCommitted(ordered, nextTotal, hasMore) {
        log.calls.push("immediate");
        log.immediate.push({
          ids: ordered.map((i) => i.id),
          nextTotal,
          hasMore,
        });
      },
      applyHeldCommitted(ordered, nextTotal, hasMore) {
        log.calls.push("held");
        log.held.push({
          ids: ordered.map((i) => i.id),
          nextTotal,
          hasMore,
        });
      },
      syncCommittedRefs(ordered, nextTotal) {
        log.calls.push("refs");
        log.refs.push({ ids: ordered.map((i) => i.id), nextTotal });
      },
      setCommittedBodyStamps(stamps) {
        log.calls.push("stamps");
        log.bodyStampKeys.push([...stamps.keys()]);
      },
      writeQueryCache() {
        log.calls.push("cache");
        log.cacheWrites += 1;
      },
      onHeldCoverFlightError(err) {
        log.calls.push("heldError");
        log.heldErrors.push(err);
      },
    },
  };
}

function baseInput(
  overrides: Partial<Parameters<typeof runDashboardCommitToDisplay>[0]> & {
    items?: ItemFile[];
    maps?: CoverMaps;
  } = {},
) {
  const { items: itemsOverride, maps: mapsOverride, ...inputOverrides } =
    overrides;
  const items = itemsOverride ?? [stubItem("a"), stubItem("b")];
  const prevItems =
    inputOverrides.prevItems ?? items;
  const ids = inputOverrides.ids ?? items.map((i) => i.id);
  const byId =
    inputOverrides.byId ?? new Map(items.map((i) => [i.id, i]));
  const bodyStamps =
    inputOverrides.bodyStamps ??
    new Map(items.map((i) => [i.id, `${i.id}:${i.updated_at}`]));
  const committedBodyStamps =
    inputOverrides.committedBodyStamps ??
    new Map(prevItems.map((i) => [i.id, `${i.id}:${i.updated_at}`]));
  let maps = mapsOverride ?? mapsResolvedFor(items);
  const sinkBundle = createSink();
  const intersectCalls: Array<{
    ids: string[];
    deferPublish?: boolean;
    requestVersion?: number;
  }> = [];
  const flightCalls: Array<{
    requestVersion: number;
    ids: string[];
    blockOnCovers?: boolean;
    deferUiCommit?: boolean;
  }> = [];

  const defaultCovers: Parameters<typeof runDashboardCommitToDisplay>[0]["covers"] = {
    getMaps: () => maps,
    intersect(orderedIds: string[], opts?: {
      deferPublish?: boolean;
      requestVersion?: number;
    }) {
      intersectCalls.push({
        ids: [...orderedIds],
        deferPublish: opts?.deferPublish,
        requestVersion: opts?.requestVersion,
      });
    },
    flushPublished() {
      sinkBundle.log.calls.push("flushPublished");
    },
    cancelDeferredPublish(version?: number) {
      sinkBundle.log.calls.push(`cancel:${version}`);
    },
  };

  const defaultFlight: Parameters<
    typeof runDashboardCommitToDisplay
  >[0]["startCoverPathFlight"] = async (
    requestVersion: number,
    orderedItems: ItemFile[],
    options?: { blockOnCovers?: boolean; deferUiCommit?: boolean },
  ) => {
    flightCalls.push({
      requestVersion,
      ids: orderedItems.map((i) => i.id),
      blockOnCovers: options?.blockOnCovers,
      deferUiCommit: options?.deferUiCommit,
    });
  };

  const input: Parameters<typeof runDashboardCommitToDisplay>[0] = {
    requestVersion: 1,
    blockOnCovers: false,
    ids,
    byId,
    end: ids.length,
    nextTotal: ids.length,
    prevItems,
    prevTotal: prevItems.length,
    bodyStamps,
    committedBodyStamps,
    getCurrentVersion: () => 1,
    flushSync: (fn: () => void) => fn(),
    covers: defaultCovers,
    startCoverPathFlight: defaultFlight,
    sink: sinkBundle.sink,
    ...inputOverrides,
  };

  if (inputOverrides.covers === undefined) {
    input.covers = defaultCovers;
  }
  if (inputOverrides.startCoverPathFlight === undefined) {
    input.startCoverPathFlight = defaultFlight;
  }
  if (inputOverrides.sink === undefined) {
    input.sink = sinkBundle.sink;
  }

  return {
    input,
    sinkBundle: sinkBundle.log,
    intersectCalls,
    flightCalls,
    getMaps: () => maps,
  };
}

describe("runDashboardCommitToDisplay (#416)", () => {
  it("returns skipped when request version is stale at entry", async () => {
    const { input, sinkBundle } = baseInput({
      getCurrentVersion: () => 2,
    });
    const result = await runDashboardCommitToDisplay(input);
    assert.equal(result, "skipped");
    assert.deepEqual(sinkBundle.calls, []);
  });

  it("returns skipped for empty commit that would blank a held paint", async () => {
    const prev = [stubItem("a")];
    const { input, sinkBundle } = baseInput({
      items: [],
      prevItems: prev,
      nextTotal: 5,
      end: 0,
      ids: [],
      byId: new Map(),
      bodyStamps: new Map(),
      committedBodyStamps: new Map([["a", "a:t"]]),
    });
    const result = await runDashboardCommitToDisplay(input);
    assert.equal(result, "skipped");
    assert.deepEqual(sinkBundle.calls, []);
  });

  it("returns skipped when paint short-circuits and covers need no resolve", async () => {
    const items = [stubItem("a"), stubItem("b")];
    const { input, sinkBundle, flightCalls } = baseInput({
      items,
      prevItems: items,
      maps: mapsResolvedFor(items),
    });
    const result = await runDashboardCommitToDisplay(input);
    assert.equal(result, "skipped");
    assert.equal(flightCalls.length, 0);
    assert.deepEqual(sinkBundle.calls, []);
  });

  it("immediate paint when ids unchanged and not holding covers", async () => {
    const prev = [stubItem("a", { title: "old" })];
    const next = [stubItem("a", { title: "new" })];
    const { input, sinkBundle, intersectCalls, flightCalls } = baseInput({
      items: next,
      prevItems: prev,
      committedBodyStamps: new Map([["a", "stale"]]),
      maps: mapsResolvedFor(next),
    });
    const result = await runDashboardCommitToDisplay(input);
    assert.equal(result, "done");
    assert.equal(intersectCalls.length, 1);
    assert.equal(intersectCalls[0]?.deferPublish, false);
    assert.deepEqual(sinkBundle.immediate, [
      { ids: ["a"], nextTotal: 1, hasMore: false },
    ]);
    assert.equal(sinkBundle.held.length, 0);
    assert.ok(sinkBundle.cacheWrites >= 1);
    assert.equal(flightCalls.length, 0);
  });

  it("holds paint, runs flight, then reveal when blockOnCovers", async () => {
    const items = [stubItem("a"), stubItem("b")];
    const { input, sinkBundle, intersectCalls, flightCalls } = baseInput({
      items,
      prevItems: [],
      prevTotal: 0,
      committedBodyStamps: new Map(),
      blockOnCovers: true,
      maps: emptyCoverMaps(),
    });
    const result = await runDashboardCommitToDisplay(input);
    assert.equal(result, "done");
    assert.equal(intersectCalls[0]?.deferPublish, true);
    assert.equal(intersectCalls[0]?.requestVersion, 1);
    assert.deepEqual(flightCalls, [
      {
        requestVersion: 1,
        ids: ["a", "b"],
        blockOnCovers: true,
        deferUiCommit: true,
      },
    ]);
    assert.deepEqual(sinkBundle.held, [
      { ids: ["a", "b"], nextTotal: 2, hasMore: false },
    ]);
    assert.deepEqual(sinkBundle.refs, [
      { ids: ["a", "b"], nextTotal: 2 },
    ]);
    assert.ok(sinkBundle.calls.includes("flushPublished"));
    assert.ok(sinkBundle.cacheWrites >= 1);
  });

  it("returns cancelled-stale when held reveal sees a newer version", async () => {
    let version = 1;
    const items = [stubItem("a")];
    const { input, sinkBundle } = baseInput({
      items,
      prevItems: [],
      prevTotal: 0,
      committedBodyStamps: new Map(),
      blockOnCovers: true,
      maps: emptyCoverMaps(),
      getCurrentVersion: () => version,
      startCoverPathFlight: async () => {
        version = 2;
      },
    });
    const result = await runDashboardCommitToDisplay(input);
    assert.equal(result, "cancelled-stale");
    assert.equal(sinkBundle.held.length, 0);
    assert.equal(sinkBundle.refs.length, 0);
    assert.ok(sinkBundle.calls.includes("cancel:1"));
  });

  it("reports held flight errors and still reveals", async () => {
    const items = [stubItem("a")];
    const err = new Error("flight failed");
    const { input, sinkBundle } = baseInput({
      items,
      prevItems: [],
      prevTotal: 0,
      committedBodyStamps: new Map(),
      blockOnCovers: true,
      maps: emptyCoverMaps(),
      startCoverPathFlight: async () => {
        throw err;
      },
    });
    const result = await runDashboardCommitToDisplay(input);
    assert.equal(result, "done");
    assert.deepEqual(sinkBundle.heldErrors, [err]);
    assert.equal(sinkBundle.held.length, 1);
  });

  it("rethrows cover flight errors when paint is not held", async () => {
    const prev = [stubItem("a")];
    const next = [stubItem("a", { thumbnail: "x.webp" })];
    const unresolved: CoverMaps = {
      paths: new Map(),
      stamps: new Map(),
      sizes: new Map(),
    };
    const { input } = baseInput({
      items: next,
      prevItems: prev,
      committedBodyStamps: new Map([["a", "a:2026-01-01T00:00:00.000Z"]]),
      bodyStamps: new Map([["a", "a:2026-01-01T00:00:00.000Z"]]),
      maps: unresolved,
      blockOnCovers: false,
      startCoverPathFlight: async () => {
        throw new Error("boom");
      },
    });
    await assert.rejects(
      () => runDashboardCommitToDisplay(input),
      /boom/,
    );
  });
});
