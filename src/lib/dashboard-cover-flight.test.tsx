/**
 * Cover-flight paint races (#885): observe DOM after flight sequencing.
 * A prod bug that skips commit, aborts a shared waiter, or paints a stale
 * resolve must fail these assertions — not resolve call-counts / flight flags.
 */
import {
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ItemFile } from "@collector/shared";
import {
  coverMapsFromTriple,
  emptyCoverMaps,
  itemCoverStamp,
  type CoverMaps,
} from "./cover-maps.ts";
import {
  runCoverPathFlight,
  type CoverFlightSlot,
  type ResolveCoverPathsProgressive,
} from "./dashboard-cover-flight.ts";

afterEach(() => {
  cleanup();
});

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
    thumbnail: "c.webp",
    ...overrides,
  } as ItemFile;
}

type FlightDriver = {
  fly: (input: {
    requestVersion: number;
    getRequestVersion: () => number;
    resolveProgressive: ResolveCoverPathsProgressive;
    scheduleFlush?: (flush: () => void) => () => void;
  }) => Promise<void>;
};

function FlightPaintRoot(props: {
  items: ItemFile[];
  initialMaps: CoverMaps;
  driverRef: MutableRefObject<FlightDriver | null>;
}): ReactElement {
  const [maps, setMaps] = useState(props.initialMaps);
  const mapsRef = useRef(maps);
  mapsRef.current = maps;
  const flightRef = useRef<CoverFlightSlot>(null);

  props.driverRef.current = {
    fly: async (input) => {
      await runCoverPathFlight({
        requestVersion: input.requestVersion,
        getRequestVersion: input.getRequestVersion,
        orderedItems: props.items,
        getOrderedIds: () => props.items.map((item) => item.id),
        getMaps: () => mapsRef.current,
        commit: (next) => {
          mapsRef.current = next;
          setMaps(next);
        },
        getFlight: () => flightRef.current,
        setFlight: (next) => {
          flightRef.current = next;
        },
        resolveProgressive: input.resolveProgressive,
        scheduleFlush: input.scheduleFlush,
      });
    },
  };

  return (
    <ul data-testid="cover-flight-paint">
      {props.items.map((item) => {
        const path = maps.paths.get(item.id);
        const size = maps.sizes.get(item.id);
        return (
          <li key={item.id} data-testid={`row-${item.id}`}>
            <button type="button">{item.title}</button>
            {path ? (
              <img
                data-testid={`cover-${item.id}`}
                src={path}
                alt=""
                width={size?.width ?? undefined}
                height={size?.height ?? undefined}
              />
            ) : (
              <span data-testid={`hole-${item.id}`}>no-cover</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function microFlushSchedule(flush: () => void): () => void {
  queueMicrotask(flush);
  return () => {};
}

describe("runCoverPathFlight paint sequencing (#885)", () => {
  it("already-resolved maps keep the painted cover (no hole flicker)", async () => {
    const item = stubItem("a");
    const stamp = itemCoverStamp(item);
    const initial = coverMapsFromTriple(
      new Map([["a", "/a"]]),
      new Map([["a", stamp]]),
      new Map([["a", { width: 10, height: 10 }]]),
    );
    const driverRef: MutableRefObject<FlightDriver | null> = { current: null };

    render(
      <FlightPaintRoot
        items={[item]}
        initialMaps={initial}
        driverRef={driverRef}
      />,
    );

    expect(screen.getByTestId("cover-a")).toHaveAttribute("src", "/a");

    await act(async () => {
      await driverRef.current!.fly({
        requestVersion: 1,
        getRequestVersion: () => 1,
        resolveProgressive: async () => {
          throw new Error("resolve must not run when maps are already ready");
        },
      });
    });

    expect(screen.getByTestId("cover-a")).toHaveAttribute("src", "/a");
    expect(screen.queryByTestId("hole-a")).not.toBeInTheDocument();
  });

  it("sticky-null hole re-opens so disk cover paints (#871)", async () => {
    const item = stubItem("a", { thumbnail: null });
    const stamp = itemCoverStamp(item);
    const initial = coverMapsFromTriple(
      new Map([["a", null]]),
      new Map([["a", stamp]]),
      new Map([["a", null]]),
    );
    const driverRef: MutableRefObject<FlightDriver | null> = { current: null };

    render(
      <FlightPaintRoot
        items={[item]}
        initialMaps={initial}
        driverRef={driverRef}
      />,
    );

    expect(screen.getByTestId("hole-a")).toBeInTheDocument();

    await act(async () => {
      await driverRef.current!.fly({
        requestVersion: 1,
        getRequestVersion: () => 1,
        scheduleFlush: microFlushSchedule,
        resolveProgressive: async (_items, options) => {
          options.onResolved?.("a", "/media/a/cover.webp", {
            width: 20,
            height: 10,
          });
        },
      });
    });

    expect(screen.getByTestId("cover-a")).toHaveAttribute(
      "src",
      "/media/a/cover.webp",
    );
    expect(screen.queryByTestId("hole-a")).not.toBeInTheDocument();
  });

  it("progressive resolve commits the cover into the painted list", async () => {
    const item = stubItem("a");
    const driverRef: MutableRefObject<FlightDriver | null> = { current: null };

    render(
      <FlightPaintRoot
        items={[item]}
        initialMaps={emptyCoverMaps()}
        driverRef={driverRef}
      />,
    );

    expect(screen.getByTestId("hole-a")).toBeInTheDocument();

    await act(async () => {
      await driverRef.current!.fly({
        requestVersion: 1,
        getRequestVersion: () => 1,
        scheduleFlush: microFlushSchedule,
        resolveProgressive: async (_items, options) => {
          options.onResolved?.("a", "/cover-a", { width: 100, height: 80 });
        },
      });
    });

    const cover = screen.getByTestId("cover-a");
    expect(cover).toHaveAttribute("src", "/cover-a");
    expect(cover).toHaveAttribute("width", "100");
    expect(cover).toHaveAttribute("height", "80");
  });

  it("same-version waiters share one flight: paint shows the first resolve path", async () => {
    const item = stubItem("a");
    const driverRef: MutableRefObject<FlightDriver | null> = { current: null };
    let releaseResolve: (() => void) | null = null;
    let resolveGeneration = 0;

    render(
      <FlightPaintRoot
        items={[item]}
        initialMaps={emptyCoverMaps()}
        driverRef={driverRef}
      />,
    );

    // Do not await fly inside act — first resolve blocks until releaseResolve.
    let first!: Promise<void>;
    act(() => {
      first = driverRef.current!.fly({
        requestVersion: 1,
        getRequestVersion: () => 1,
        scheduleFlush: microFlushSchedule,
        resolveProgressive: async (_items, options) => {
          resolveGeneration += 1;
          await new Promise<void>((resolve) => {
            releaseResolve = resolve;
          });
          options.onResolved?.("a", `/shared-${resolveGeneration}`, {
            width: 10,
            height: 10,
          });
        },
      });
    });

    // First flight must be registered before the shared waiter joins.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let second!: Promise<void>;
    act(() => {
      second = driverRef.current!.fly({
        requestVersion: 1,
        getRequestVersion: () => 1,
        scheduleFlush: microFlushSchedule,
        resolveProgressive: async (_items, options) => {
          resolveGeneration += 1;
          options.onResolved?.("a", `/shared-${resolveGeneration}`, {
            width: 99,
            height: 99,
          });
        },
      });
    });

    await act(async () => {
      releaseResolve!();
      await Promise.all([first, second]);
    });

    // Shared waiter must not start a second resolve that overwrites paint.
    expect(screen.getByTestId("cover-a")).toHaveAttribute("src", "/shared-1");
  });

  it("stale requestVersion leaves the hole unpainted (no late commit)", async () => {
    const item = stubItem("a");
    let version = 1;
    const driverRef: MutableRefObject<FlightDriver | null> = { current: null };

    render(
      <FlightPaintRoot
        items={[item]}
        initialMaps={emptyCoverMaps()}
        driverRef={driverRef}
      />,
    );

    expect(screen.getByTestId("hole-a")).toBeInTheDocument();

    await act(async () => {
      await driverRef.current!.fly({
        requestVersion: 1,
        getRequestVersion: () => version,
        scheduleFlush: microFlushSchedule,
        resolveProgressive: async (_items, options) => {
          version = 2;
          options.onResolved?.("a", "/stale-cover", { width: 10, height: 10 });
        },
      });
    });

    expect(screen.getByTestId("hole-a")).toBeInTheDocument();
    expect(screen.queryByTestId("cover-a")).not.toBeInTheDocument();
  });
});
