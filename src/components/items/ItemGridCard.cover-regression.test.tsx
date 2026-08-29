import {
  useLayoutEffect,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ItemFile } from "@collector/shared";
import {
  coverMapsFromTriple,
  coverMapsResolveForGrid,
  itemCoverStamp,
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

afterEach(() => {
  cleanup();
});

/** Fixed column width for jsdom height fingerprints (jsdom has no real layout). */
const GRID_COL_W = 280;
const TEXT_ONLY_H = 231;

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

function seedReadyMaps(items: ItemFile[]) {
  const paths = new Map<string, string | null>();
  const stamps = new Map<string, string>();
  const sizes = new Map<string, { width: number; height: number } | null>();
  for (const item of items) {
    paths.set(item.id, `/vault/${item.id}/cover.webp`);
    stamps.set(item.id, itemCoverStamp(item));
    sizes.set(item.id, { width: 400, height: 300 });
  }
  return coverMapsFromTriple(paths, stamps, sizes);
}

/**
 * Card height for shift detection. Prefer real layout; in jsdom invent height
 * from reserved cover slot vs text-only — assert is still Δheight, not path/aspect.
 */
function cardHeight(card: HTMLElement): number {
  const live = card.getBoundingClientRect().height;
  if (live > 0) {
    return Math.round(live);
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

function sampleCardHeights(root: HTMLElement): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of root.querySelectorAll("[data-testid^='row-']")) {
    const id = row.getAttribute("data-testid")?.slice("row-".length);
    if (!id) {
      continue;
    }
    const card = row.querySelector('[role="button"]');
    if (!(card instanceof HTMLElement)) {
      continue;
    }
    out.set(id, cardHeight(card));
  }
  return out;
}

/** Same id, height changed between consecutive samples — the live Teapot→Coding symptom. */
function heightShifts(
  prev: Map<string, number> | null,
  next: Map<string, number>,
): Array<{ id: string; from: number; to: number }> {
  if (!prev) {
    return [];
  }
  const shifts: Array<{ id: string; from: number; to: number }> = [];
  for (const [id, h] of next) {
    const before = prev.get(id);
    if (before !== undefined && before !== h) {
      shifts.push({ id, from: before, to: h });
    }
  }
  return shifts;
}

type ListApi = {
  list: DashboardListState;
  covers: CoverController;
};

type LiveListHarnessProps = {
  covers: CoverController;
  startCoverPathFlightRef: MutableRefObject<StartCoverPathFlight>;
  apiRef: { current: ListApi | null };
  heightLog: Map<string, number>[];
};

/**
 * Real list state + published cover maps → real ItemGridCard.
 * Each layout records card heights; tests assert no Δheight while visible.
 */
function LiveDashboardListHarness(props: LiveListHarnessProps): ReactElement {
  const { covers, startCoverPathFlightRef, apiRef, heightLog } = props;

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
    const root = document.querySelector("[data-testid='harness']");
    if (!(root instanceof HTMLElement)) {
      return;
    }
    const sample = sampleCardHeights(root);
    if (sample.size > 0) {
      heightLog.push(sample);
    }
  });

  return (
    <div data-testid="harness">
      <ul>
        {list.committedItems.map((item) => {
          const { path, size } = coverMapsResolveForGrid(coverMaps, item);
          return (
            <li key={item.id} data-testid={`row-${item.id}`}>
              <ItemGridCard
                item={item}
                thumbnailPath={path}
                thumbnailSize={size}
                tagsById={new Map()}
                onOpen={() => {}}
              />
            </li>
          );
        })}
      </ul>
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

function allHeightShifts(
  heightLog: Map<string, number>[],
): Array<{ id: string; from: number; to: number }> {
  const out: Array<{ id: string; from: number; to: number }> = [];
  for (let i = 1; i < heightLog.length; i++) {
    out.push(...heightShifts(heightLog[i - 1]!, heightLog[i]!));
  }
  return out;
}

describe("dashboard cover layout shift (#855 / #874)", () => {
  it("blockOnCovers: no card height shift after commit", async () => {
    const item = stubItem("new", "New Item");
    const covers = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 1,
      getQueryKey: () => "k",
      getItem: (id) => (id === item.id ? item : undefined),
    });

    const startCoverPathFlightRef = {
      current: (async (
        requestVersion,
        orderedItems,
        flightOptions,
      ) => {
        covers.replaceMaps(seedReadyMaps(orderedItems), {
          deferPublish: flightOptions?.deferUiCommit === true,
          requestVersion:
            flightOptions?.deferUiCommit === true ? requestVersion : undefined,
        });
        await Promise.resolve();
      }) as StartCoverPathFlight,
    };

    const heightLog: Map<string, number>[] = [];
    const apiRef: { current: ListApi | null } = { current: null };

    render(
      <LiveDashboardListHarness
        covers={covers}
        startCoverPathFlightRef={startCoverPathFlightRef}
        apiRef={apiRef}
        heightLog={heightLog}
      />,
    );

    const list = apiRef.current!.list;
    act(() => {
      seedWorkingWindow(list, [item]);
      list.requestVersionRef.current = 1;
    });

    await act(async () => {
      await list.commitWorkingToDisplay(1, { blockOnCovers: true });
    });

    expect(screen.getByText("New Item")).toBeInTheDocument();
    expect(allHeightShifts(heightLog)).toEqual([]);
  });

  it("regression: list then maps → card height shifts (live Teapot→Coding class)", async () => {
    const item = stubItem("new", "Broken Path");
    const covers = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 1,
      getQueryKey: () => "k",
      getItem: (id) => (id === item.id ? item : undefined),
    });

    const startCoverPathFlightRef = {
      current: (async (
        requestVersion,
        orderedItems,
        flightOptions,
      ) => {
        covers.replaceMaps(seedReadyMaps(orderedItems), {
          deferPublish: flightOptions?.deferUiCommit === true,
          requestVersion:
            flightOptions?.deferUiCommit === true ? requestVersion : undefined,
        });
        await Promise.resolve();
      }) as StartCoverPathFlight,
    };

    const heightLog: Map<string, number>[] = [];
    const apiRef: { current: ListApi | null } = { current: null };

    render(
      <LiveDashboardListHarness
        covers={covers}
        startCoverPathFlightRef={startCoverPathFlightRef}
        apiRef={apiRef}
        heightLog={heightLog}
      />,
    );

    const list = apiRef.current!.list;
    act(() => {
      seedWorkingWindow(list, [item]);
      list.requestVersionRef.current = 1;
    });

    // Pre-fix hazard: paint list, then publish maps — heights must jump.
    await act(async () => {
      covers.intersect([item.id], { deferPublish: true, requestVersion: 1 });
      await startCoverPathFlightRef.current(1, [item], {
        blockOnCovers: true,
        deferUiCommit: true,
      });
      list.setCommittedItems([item]);
    });

    await act(async () => {
      covers.flushPublished();
    });

    const shifts = allHeightShifts(heightLog);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.some((s) => s.id === "new" && s.to > s.from)).toBe(true);
  });

  it("regression: paint with holes then progressive maps → height shifts", async () => {
    const item = stubItem("new", "Late Covers");
    const covers = createCoverController({
      resolveProgressive: async () => {},
      getRequestVersion: () => 1,
      getQueryKey: () => "k",
      getItem: (id) => (id === item.id ? item : undefined),
    });

    const startCoverPathFlightRef = {
      current: (async () => {}) as StartCoverPathFlight,
    };
    const heightLog: Map<string, number>[] = [];
    const apiRef: { current: ListApi | null } = { current: null };

    render(
      <LiveDashboardListHarness
        covers={covers}
        startCoverPathFlightRef={startCoverPathFlightRef}
        apiRef={apiRef}
        heightLog={heightLog}
      />,
    );

    const list = apiRef.current!.list;
    act(() => {
      seedWorkingWindow(list, [item]);
      list.requestVersionRef.current = 1;
      // Warm/hole path: items on screen before covers ready (live CLS).
      list.setCommittedItems([item]);
    });

    await act(async () => {
      covers.replaceMaps(seedReadyMaps([item]));
    });

    const shifts = allHeightShifts(heightLog);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.some((s) => s.id === "new" && s.to > s.from)).toBe(true);
  });
});

describe("cold reveal call sites (#855 / #874)", () => {
  it("list state and apply-index only reveal held paint via revealHeldListPaint", () => {
    const root = join(process.cwd());
    const listSrc = readFileSync(
      join(root, "src/hooks/dashboard/useDashboardListState.ts"),
      "utf8",
    );
    const apply = readFileSync(
      join(root, "src/hooks/dashboard/apply-index-page-against-list.ts"),
      "utf8",
    );

    expect(listSrc).toContain('from "../../lib/dashboard-cold-reveal"');
    expect(apply).toContain('from "../../lib/dashboard-cold-reveal"');
    expect(listSrc).toMatch(/revealHeldListPaint\s*\(/);
    expect(apply).toMatch(/revealHeldListPaint\s*\(/);

    const heldAt = listSrc.indexOf("if (heldListPaint)");
    expect(heldAt).toBeGreaterThanOrEqual(0);
    const heldBlock = listSrc.slice(heldAt, heldAt + 900);
    expect(heldBlock).toContain("revealHeldListPaint");
    expect(heldBlock).not.toMatch(
      /setCommittedItems\(ordered\);\s*\n\s*covers\.(publish|flushPublished)/,
    );
  });
});
