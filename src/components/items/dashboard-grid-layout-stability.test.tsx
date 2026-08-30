/**
 * Dashboard grid layout stability (#913): after a folder switch commits a list,
 * card size and position must not wave while cover maps publish.
 * Oracle = geometry only (not cover-map internals).
 */
import {
  useLayoutEffect,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Masonry from "react-masonry-css";
import type { ItemFile } from "@collector/shared";
import {
  coverMapsFromTriple,
  coverMapsResolveForGrid,
  itemCoverStamp,
  type CoverMaps,
} from "../../lib/cover-maps";
import {
  createCoverController,
  type CoverController,
} from "../../lib/cover-controller";
import { ItemGridCard } from "./ItemGridCard";
import {
  useDashboardListState,
  type StartCoverPathFlight,
} from "../../hooks/dashboard/useDashboardListState";
import type { DashboardListState } from "../../hooks/dashboard/dashboard-list-state-types";

vi.mock("../../hooks/useMainScrollElement", () => ({
  useMainScrollElement: () => document.body,
}));

const GRID_COL_W = 280;
const TEXT_ONLY_H = 231;
const COL_GAP = 16;
const COLUMN_COUNT = 2;

type CardGeom = { x: number; y: number; w: number; h: number };

const FOLDER_A_SPECS: Array<{
  id: string;
  title: string;
  size: { width: number; height: number };
}> = [
  { id: "a1", title: "A1", size: { width: 400, height: 300 } },
  { id: "a2", title: "A2", size: { width: 300, height: 450 } },
  { id: "a3", title: "A3", size: { width: 500, height: 280 } },
  { id: "a4", title: "A4", size: { width: 320, height: 480 } },
  { id: "a5", title: "A5", size: { width: 420, height: 320 } },
  { id: "a6", title: "A6", size: { width: 280, height: 400 } },
];

const FOLDER_B_SPECS: Array<{
  id: string;
  title: string;
  size: { width: number; height: number };
}> = [
  { id: "b1", title: "B1", size: { width: 360, height: 480 } },
  { id: "b2", title: "B2", size: { width: 480, height: 270 } },
  { id: "b3", title: "B3", size: { width: 300, height: 300 } },
  { id: "b4", title: "B4", size: { width: 250, height: 500 } },
  { id: "b5", title: "B5", size: { width: 440, height: 330 } },
  { id: "b6", title: "B6", size: { width: 380, height: 220 } },
];

function stubItem(id: string, title = id): ItemFile {
  return {
    id,
    title,
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    thumbnail: "cover.webp",
  } as ItemFile;
}

function itemsFromSpecs(specs: typeof FOLDER_A_SPECS): ItemFile[] {
  return specs.map((s) => stubItem(s.id, s.title));
}

function seedReadyMaps(specs: typeof FOLDER_A_SPECS): CoverMaps {
  const paths = new Map<string, string | null>();
  const stamps = new Map<string, string>();
  const sizes = new Map<string, { width: number; height: number } | null>();
  for (const spec of specs) {
    const item = stubItem(spec.id, spec.title);
    paths.set(spec.id, `/vault/${spec.id}/cover.webp`);
    stamps.set(spec.id, itemCoverStamp(item));
    sizes.set(spec.id, spec.size);
  }
  return coverMapsFromTriple(paths, stamps, sizes);
}

function sizeById(
  specs: typeof FOLDER_A_SPECS,
): Map<string, { width: number; height: number }> {
  return new Map(specs.map((s) => [s.id, s.size]));
}

/** Height from reserved cover slot vs text-only (jsdom has no real layout). */
function fingerprintHeight(host: HTMLElement): number {
  const card =
    host.getAttribute("role") === "button"
      ? host
      : host.querySelector('[role="button"]');
  if (!(card instanceof HTMLElement)) {
    return TEXT_ONLY_H;
  }
  const slot = card.querySelector("[style*='aspect-ratio']");
  const style = slot?.getAttribute("style") ?? "";
  const match = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(style);
  if (match) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    return Math.round((GRID_COL_W * h) / w) + 80;
  }
  return TEXT_ONLY_H;
}

/**
 * Patch measurement so Masonry column flow gets non-zero heights.
 * Position oracle uses column index + stacked fingerprint heights (same as
 * flex-column masonry visually: losing a cover slot shifts cards below).
 */
function installLayoutFingerprints(): () => void {
  const proto = HTMLElement.prototype;
  const prevOffsetHeight = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const prevOffsetWidth = Object.getOwnPropertyDescriptor(proto, "offsetWidth");

  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (
        this.hasAttribute("data-dashboard-card") ||
        this.getAttribute("role") === "button"
      ) {
        return fingerprintHeight(this);
      }
      return prevOffsetHeight?.get?.call(this) ?? 0;
    },
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (
        this.hasAttribute("data-dashboard-card") ||
        this.getAttribute("role") === "button"
      ) {
        return GRID_COL_W;
      }
      return prevOffsetWidth?.get?.call(this) ?? 0;
    },
  });

  return () => {
    if (prevOffsetHeight) {
      Object.defineProperty(proto, "offsetHeight", prevOffsetHeight);
    }
    if (prevOffsetWidth) {
      Object.defineProperty(proto, "offsetWidth", prevOffsetWidth);
    }
  };
}

function sampleCardGeometry(root: HTMLElement): Map<string, CardGeom> {
  const out = new Map<string, CardGeom>();
  const columns = root.querySelectorAll(".my-masonry-grid_column");
  columns.forEach((col, colIdx) => {
    let y = 0;
    for (const card of col.querySelectorAll("[data-dashboard-card]")) {
      if (!(card instanceof HTMLElement)) {
        continue;
      }
      const id = card.getAttribute("data-item-id");
      if (!id) {
        continue;
      }
      const h = fingerprintHeight(card);
      out.set(id, {
        x: colIdx * GRID_COL_W,
        y,
        w: GRID_COL_W,
        h,
      });
      y += h + COL_GAP;
    }
  });
  return out;
}

function geometryShifts(
  log: Map<string, CardGeom>[],
  kind: "size" | "position",
): Array<{ id: string; from: CardGeom; to: CardGeom }> {
  const shifts: Array<{ id: string; from: CardGeom; to: CardGeom }> = [];
  for (let i = 1; i < log.length; i++) {
    const prev = log[i - 1]!;
    const next = log[i]!;
    for (const [id, geom] of next) {
      const before = prev.get(id);
      if (!before) {
        continue;
      }
      if (kind === "size") {
        if (before.w !== geom.w || before.h !== geom.h) {
          shifts.push({ id, from: before, to: geom });
        }
      } else if (before.x !== geom.x || before.y !== geom.y) {
        shifts.push({ id, from: before, to: geom });
      }
    }
  }
  return shifts;
}

/** Samples after the committed id set matches `expectedIds` (folder B on screen). */
function logAfterListCommit(
  log: Map<string, CardGeom>[],
  expectedIds: string[],
): Map<string, CardGeom>[] {
  const want = expectedIds.slice().sort().join("|");
  const start = log.findIndex((sample) => {
    const got = [...sample.keys()].sort().join("|");
    return got === want;
  });
  if (start < 0) {
    return [];
  }
  return log.slice(start);
}

type ListApi = {
  list: DashboardListState;
  covers: CoverController;
};

type GridHarnessProps = {
  covers: CoverController;
  startCoverPathFlightRef: MutableRefObject<StartCoverPathFlight>;
  apiRef: { current: ListApi | null };
  geometryLog: Map<string, CardGeom>[];
};

function DashboardGridLayoutHarness(props: GridHarnessProps): ReactElement {
  const { covers, startCoverPathFlightRef, apiRef, geometryLog } = props;

  const list = useDashboardListState({
    filter: { type: "folder", folderPath: "Coding" },
    searchQuery: "",
    sort: { key: "created_at", dir: "desc" },
    vaultId: "vault-test",
    startCoverPathFlightRef,
    covers,
    initialCache: null,
  });

  const coverMaps = useSyncExternalStore(
    covers.subscribe,
    covers.getPublishedMaps,
    covers.getPublishedMaps,
  );

  apiRef.current = { list, covers };

  useLayoutEffect(() => {
    const root = document.querySelector("[data-testid='grid-harness']");
    if (!(root instanceof HTMLElement)) {
      return;
    }
    const sample = sampleCardGeometry(root);
    if (sample.size > 0) {
      geometryLog.push(sample);
    }
  });

  return (
    <div
      data-testid="grid-harness"
      style={{ width: GRID_COL_W * COLUMN_COUNT }}
    >
      <Masonry
        breakpointCols={COLUMN_COUNT}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {list.committedItems.map((item) => {
          const { path, size } = coverMapsResolveForGrid(coverMaps, item);
          return (
            <div key={item.id} data-dashboard-card data-item-id={item.id}>
              <ItemGridCard
                item={item}
                thumbnailPath={path}
                thumbnailSize={size}
                tagsById={new Map()}
                onOpen={() => {}}
              />
            </div>
          );
        })}
      </Masonry>
    </div>
  );
}

function seedWorkingWindow(list: DashboardListState, items: ItemFile[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = items.map((item) => item.id);
  list.setItemsById(byId);
  list.itemsByIdRef.current = byId;
  list.setLoadedItemIds(ids);
  list.setStreamWindowEnd(ids.length);
  list.setTotalCount(ids.length);
  list.totalCountRef.current = ids.length;
  for (const item of items) {
    list.bodyStampsRef.current.set(item.id, `${item.id}:body`);
  }
}

async function runFolderSwitchWithProgressiveCovers(input: {
  geometryLog: Map<string, CardGeom>[];
}): Promise<void> {
  const { geometryLog } = input;
  const folderA = itemsFromSpecs(FOLDER_A_SPECS);
  const folderB = itemsFromSpecs(FOLDER_B_SPECS);
  const bSizes = sizeById(FOLDER_B_SPECS);

  let requestVersion = 1;
  let flightTail: Promise<void> = Promise.resolve();

  const covers = createCoverController({
    resolveProgressive: async (items, options) => {
      for (const item of items) {
        const size = bSizes.get(item.id) ?? { width: 400, height: 300 };
        options.onResolved?.(item.id, `/vault/${item.id}/cover.webp`, size);
        // Yield so the batcher microtask flush publishes one wave at a time.
        await Promise.resolve();
      }
    },
    getRequestVersion: () => requestVersion,
    getQueryKey: () => "folder:test",
    getItem: (id) =>
      folderA.find((i) => i.id === id) ?? folderB.find((i) => i.id === id),
  });

  const startCoverPathFlightRef: MutableRefObject<StartCoverPathFlight> = {
    current: async (rv, orderedItems, flightOptions) => {
      const blockOnCovers = flightOptions?.blockOnCovers ?? false;
      const pending = covers.beginFlight(rv, orderedItems, flightOptions);
      flightTail = pending;
      if (blockOnCovers) {
        await pending;
        return;
      }
      // Match production sync path: do not await progressive publish.
      void pending.catch(() => {});
    },
  };

  const apiRef: { current: ListApi | null } = { current: null };

  render(
    <DashboardGridLayoutHarness
      covers={covers}
      startCoverPathFlightRef={startCoverPathFlightRef}
      apiRef={apiRef}
      geometryLog={geometryLog}
    />,
  );

  const list = apiRef.current!.list;

  // Folder A: ready covers, one paint.
  act(() => {
    seedWorkingWindow(list, folderA);
    list.requestVersionRef.current = requestVersion;
    covers.replaceMaps(seedReadyMaps(FOLDER_A_SPECS));
  });
  await act(async () => {
    await list.commitWorkingToDisplay(requestVersion, { blockOnCovers: true });
  });

  // Folder B: sync-style commit (blockOnCovers false) → maps intersect/publish
  // while list is already visible, then progressive cover waves (#913 class).
  requestVersion = 2;
  act(() => {
    seedWorkingWindow(list, folderB);
    list.requestVersionRef.current = requestVersion;
  });
  await act(async () => {
    await list.commitWorkingToDisplay(requestVersion, { blockOnCovers: false });
  });
  await act(async () => {
    await flightTail;
    // Extra turn so the last batcher publish + layout sample land.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("dashboard grid layout stability (#913)", () => {
  let restoreFingerprints: (() => void) | undefined;

  beforeEach(() => {
    restoreFingerprints = installLayoutFingerprints();
    // Cover batcher defaults to rAF; run as microtasks so waves are observable.
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback): number => {
        queueMicrotask(() => {
          cb(0);
        });
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    cleanup();
    restoreFingerprints?.();
    vi.unstubAllGlobals();
  });

  it("after folder B list commit, card sizes do not change while covers publish", async () => {
    const geometryLog: Map<string, CardGeom>[] = [];
    await runFolderSwitchWithProgressiveCovers({ geometryLog });

    const windowLog = logAfterListCommit(
      geometryLog,
      FOLDER_B_SPECS.map((s) => s.id),
    );
    expect(windowLog.length).toBeGreaterThan(0);
    expect(geometryShifts(windowLog, "size")).toEqual([]);
  });

  it("after folder B list commit, card positions do not change while covers publish", async () => {
    const geometryLog: Map<string, CardGeom>[] = [];
    await runFolderSwitchWithProgressiveCovers({ geometryLog });

    const windowLog = logAfterListCommit(
      geometryLog,
      FOLDER_B_SPECS.map((s) => s.id),
    );
    expect(windowLog.length).toBeGreaterThan(0);
    expect(geometryShifts(windowLog, "position")).toEqual([]);
  });
});

describe("cold reveal call sites (#855 / #874)", () => {
  it("list state and apply-index only reveal held paint via revealHeldListPaint", () => {
    const root = join(process.cwd());
    const listSrc = readFileSync(
      join(root, "src/hooks/dashboard/useDashboardListState.ts"),
      "utf8",
    );
    const commitSrc = readFileSync(
      join(root, "src/lib/dashboard-commit-to-display.ts"),
      "utf8",
    );
    const apply = readFileSync(
      join(root, "src/hooks/dashboard/apply-index-page-against-list.ts"),
      "utf8",
    );

    expect(listSrc).toContain('from "../../lib/dashboard-commit-to-display"');
    expect(listSrc).toMatch(/runDashboardCommitToDisplay\s*\(/);
    expect(commitSrc).toContain("./dashboard-cold-reveal.ts");
    expect(apply).toContain('from "../../lib/dashboard-cold-reveal"');
    expect(commitSrc).toMatch(/revealHeldListPaint\s*\(/);
    expect(apply).toMatch(/revealHeldListPaint\s*\(/);

    const heldAt = commitSrc.indexOf("if (heldListPaint)");
    expect(heldAt).toBeGreaterThanOrEqual(0);
    const heldBlock = commitSrc.slice(heldAt, heldAt + 900);
    expect(heldBlock).toContain("revealHeldListPaint");
    expect(heldBlock).not.toMatch(
      /setCommittedItems\(ordered\);\s*\n\s*covers\.(publish|flushPublished)/,
    );
  });
});
