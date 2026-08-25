import { describe, expect, it } from "vitest";
import { BOARD_SHRINK_ORDER, type TeaserBoardId } from "./board";
import {
  compositionId,
  listAllowedCompositions,
  type TeaserComposition,
  type TeaserSpan,
} from "./composition";
import {
  boardTilingKey,
  isCompleteTiling,
  listAllowedCompositionsForBoard,
  listFullTilings,
  narrowToBoard,
} from "./tiling";

const BOARDS: TeaserBoardId[] = ["4x2", "3x2", "2x2"];

/** Locked sizes from the historical enumerateTilings search (issue #790). */
const EXPECTED_TILING_COUNTS: Record<TeaserBoardId, number> = {
  "4x2": 90,
  "3x2": 26,
  "2x2": 7,
};

describe("listFullTilings", () => {
  it("returns at least one complete tiling per board", () => {
    for (const board of BOARDS) {
      const tilings = listFullTilings(board);
      expect(tilings.length).toBeGreaterThan(0);
      for (const tiling of tilings) {
        expect(tiling.board).toBe(board);
        expect(isCompleteTiling(tiling)).toBe(true);
      }
    }
  });

  it("covers every known board with the frozen tiling counts and unique keys", () => {
    expect([...BOARD_SHRINK_ORDER]).toEqual(BOARDS);
    for (const board of BOARD_SHRINK_ORDER) {
      const tilings = listFullTilings(board);
      expect(tilings.length).toBe(EXPECTED_TILING_COUNTS[board]);
      const keys = tilings.map(boardTilingKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("returns the same precomputed list reference on every call", () => {
    for (const board of BOARD_SHRINK_ORDER) {
      expect(listFullTilings(board)).toBe(listFullTilings(board));
    }
  });

  it("includes the all-1x1 tiling on every board", () => {
    for (const board of BOARDS) {
      const tilings = listFullTilings(board);
      const allOnes = tilings.some(
        (t) =>
          t.placements.length > 0 &&
          t.placements.every((p) => p.span === "1x1"),
      );
      expect(allOnes).toBe(true);
    }
  });

  it("never places span 2x2 on board 2x2", () => {
    for (const tiling of listFullTilings("2x2")) {
      expect(tiling.placements.some((p) => p.span === "2x2")).toBe(false);
    }
  });

  it("does not allow a single 2x2 placement as a 2x2 board tiling", () => {
    const single = listFullTilings("2x2").find(
      (t) => t.placements.length === 1 && t.placements[0]?.span === "2x2",
    );
    expect(single).toBeUndefined();
  });
});

describe("listAllowedCompositionsForBoard", () => {
  it("keeps 2x2-span compositions on 4x2 and drops them on 2x2", () => {
    const onWide = listAllowedCompositionsForBoard("4x2");
    const onNarrow = listAllowedCompositionsForBoard("2x2");
    expect(onWide.some((c) => c.span === "2x2")).toBe(true);
    expect(onNarrow.some((c) => c.span === "2x2")).toBe(false);
    expect(onNarrow.every((c) => listAllowedCompositions().some(
      (a) => compositionId(a) === compositionId(c),
    ))).toBe(true);
  });
});

describe("narrowToBoard", () => {
  it("filters the same candidate pool by span without rebuilding sources", () => {
    const a = { id: "a", span: "1x1" as TeaserSpan };
    const b = { id: "b", span: "2x2" as TeaserSpan };
    const c = { id: "c", span: "2x1" as TeaserSpan };
    const pool = [a, b, c];

    const onWide = narrowToBoard(pool, "4x2", (item) => item.span);
    expect(onWide).toEqual([a, b, c]);
    expect(onWide[0]).toBe(a);
    expect(onWide[1]).toBe(b);
    expect(onWide[2]).toBe(c);

    const onMid = narrowToBoard(pool, "3x2", (item) => item.span);
    expect(onMid).toEqual([a, b, c]);
    expect(onMid[1]).toBe(b);

    const onNarrow = narrowToBoard(pool, "2x2", (item) => item.span);
    expect(onNarrow).toEqual([a, c]);
    expect(onNarrow[0]).toBe(a);
    expect(onNarrow[1]).toBe(c);
  });

  it("narrows composition objects by their span for board 2x2", () => {
    const comps: TeaserComposition[] = listAllowedCompositions().filter(
      (c) => c.span === "2x2" || c.span === "1x1",
    );
    const narrowed = narrowToBoard(comps, "2x2", (c) => c.span);
    expect(narrowed.every((c) => c.span !== "2x2")).toBe(true);
    expect(narrowed.length).toBeLessThan(comps.length);
    for (const item of narrowed) {
      expect(comps.includes(item)).toBe(true);
    }
  });
});
