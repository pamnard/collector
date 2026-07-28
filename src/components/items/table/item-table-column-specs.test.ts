import { describe, expect, it } from "vitest";
import {
  isColumnSortable,
  ITEM_TABLE_COLUMN_SPECS,
  nextDashboardSort,
} from "./item-table-column-specs";

describe("item-table-column-specs sort", () => {
  it("marks registry columns sortable only when sortKey is allowlisted", () => {
    const byId = Object.fromEntries(
      ITEM_TABLE_COLUMN_SPECS.map((spec) => [spec.id, spec]),
    );
    expect(isColumnSortable(byId.title!)).toBe(true);
    expect(isColumnSortable(byId.created_at!)).toBe(true);
    expect(isColumnSortable(byId.content_type!)).toBe(true);
    expect(isColumnSortable(byId.updated_at!)).toBe(true);
    expect(isColumnSortable(byId.tags!)).toBe(false);
    expect(isColumnSortable(byId.actions!)).toBe(false);
  });

  it("toggles direction on the same key and uses primary dir for a new key", () => {
    expect(
      nextDashboardSort({ key: "created_at", dir: "desc" }, "created_at"),
    ).toEqual({ key: "created_at", dir: "asc" });
    expect(
      nextDashboardSort({ key: "created_at", dir: "asc" }, "created_at"),
    ).toEqual({ key: "created_at", dir: "desc" });
    expect(
      nextDashboardSort({ key: "created_at", dir: "desc" }, "title"),
    ).toEqual({ key: "title", dir: "asc" });
    expect(
      nextDashboardSort({ key: "title", dir: "asc" }, "updated_at"),
    ).toEqual({ key: "updated_at", dir: "desc" });
  });
});
