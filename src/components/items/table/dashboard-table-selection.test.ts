import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_SELECTION,
  isSelected,
  loadedSelectionState,
  selectAllMatching,
  selectedCount,
  selectionQueryKey,
  shouldShowSelectAllMatching,
  toggleLoaded,
  toggleRow,
  type DashboardTableSelection,
} from "./dashboard-table-selection.ts";

const LOADED = ["a", "b", "c"];

describe("dashboard-table-selection", () => {
  describe("isSelected / selectedCount", () => {
    it("none selects nothing", () => {
      assert.equal(isSelected(EMPTY_SELECTION, "a"), false);
      assert.equal(selectedCount(EMPTY_SELECTION, 100), 0);
    });

    it("explicit uses the id set", () => {
      const sel: DashboardTableSelection = {
        mode: "explicit",
        ids: new Set(["a", "c"]),
      };
      assert.equal(isSelected(sel, "a"), true);
      assert.equal(isSelected(sel, "b"), false);
      assert.equal(selectedCount(sel, 100), 2);
    });

    it("allMatching counts total minus exclusions without storing all ids", () => {
      const sel: DashboardTableSelection = {
        mode: "allMatching",
        exclusions: new Set(["x"]),
      };
      assert.equal(isSelected(sel, "a"), true);
      assert.equal(isSelected(sel, "x"), false);
      assert.equal(selectedCount(sel, 10_000), 9_999);
    });
  });

  describe("toggleRow", () => {
    it("adds and removes in explicit mode", () => {
      let sel = toggleRow(EMPTY_SELECTION, "a");
      assert.deepEqual([...((sel as { ids: Set<string> }).ids)], ["a"]);
      sel = toggleRow(sel, "a");
      assert.equal(sel.mode, "none");
    });

    it("toggles exclusions in allMatching mode", () => {
      let sel = selectAllMatching();
      sel = toggleRow(sel, "a");
      assert.equal(sel.mode, "allMatching");
      assert.equal(isSelected(sel, "a"), false);
      sel = toggleRow(sel, "a");
      assert.equal(isSelected(sel, "a"), true);
      assert.equal((sel as { exclusions: Set<string> }).exclusions.size, 0);
    });
  });

  describe("toggleLoaded", () => {
    it("selects all loaded ids in explicit mode", () => {
      const sel = toggleLoaded(EMPTY_SELECTION, LOADED, true, 100);
      assert.equal(sel.mode, "explicit");
      assert.deepEqual(
        [...((sel as { ids: Set<string> }).ids)].sort(),
        ["a", "b", "c"],
      );
    });

    it("deselects loaded ids and collapses to none when empty", () => {
      const selected = toggleLoaded(EMPTY_SELECTION, LOADED, true, 100);
      const cleared = toggleLoaded(selected, LOADED, false, 100);
      assert.equal(cleared.mode, "none");
    });

    it("keeps non-loaded explicit ids when deselecting loaded", () => {
      const sel: DashboardTableSelection = {
        mode: "explicit",
        ids: new Set(["a", "z"]),
      };
      const next = toggleLoaded(sel, LOADED, false, 100);
      assert.equal(next.mode, "explicit");
      assert.deepEqual([...((next as { ids: Set<string> }).ids)], ["z"]);
    });

    it("allMatching check removes loaded from exclusions", () => {
      const sel: DashboardTableSelection = {
        mode: "allMatching",
        exclusions: new Set(["a", "z"]),
      };
      const next = toggleLoaded(sel, LOADED, true, 100);
      assert.equal(next.mode, "allMatching");
      assert.deepEqual(
        [...((next as { exclusions: Set<string> }).exclusions)],
        ["z"],
      );
    });

    it("allMatching uncheck adds loaded to exclusions and clears when count hits 0", () => {
      const sel = selectAllMatching();
      const next = toggleLoaded(sel, LOADED, false, 3);
      assert.equal(next.mode, "none");
    });
  });

  describe("loadedSelectionState / shouldShowSelectAllMatching", () => {
    it("reports none / some / all for loaded window", () => {
      assert.equal(loadedSelectionState(EMPTY_SELECTION, LOADED), "none");
      assert.equal(
        loadedSelectionState(
          { mode: "explicit", ids: new Set(["a"]) },
          LOADED,
        ),
        "some",
      );
      assert.equal(
        loadedSelectionState(
          { mode: "explicit", ids: new Set(LOADED) },
          LOADED,
        ),
        "all",
      );
    });

    it("shows select-all CTA only when all loaded selected and more remain", () => {
      const allLoaded: DashboardTableSelection = {
        mode: "explicit",
        ids: new Set(LOADED),
      };
      assert.equal(
        shouldShowSelectAllMatching(allLoaded, LOADED, 10),
        true,
      );
      assert.equal(
        shouldShowSelectAllMatching(allLoaded, LOADED, 3),
        false,
      );
      assert.equal(
        shouldShowSelectAllMatching(selectAllMatching(), LOADED, 10),
        false,
      );
    });
  });

  describe("selectionQueryKey", () => {
    it("includes vault, filter, and search", () => {
      assert.equal(
        selectionQueryKey({
          vaultId: "v1",
          filterKey: "folder:a",
          search: "  q  ",
        }),
        "v1|folder:a|q",
      );
    });

    it("includes sort when provided", () => {
      assert.equal(
        selectionQueryKey({
          vaultId: "v1",
          filterKey: "all",
          search: "",
          sortKey: "title",
          sortDir: "asc",
        }),
        "v1|all||title|asc",
      );
    });
  });
});
