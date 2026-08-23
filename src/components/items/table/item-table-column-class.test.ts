import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itemTableCellClassName,
  itemTableHeaderClassName,
} from "./item-table-column-class.ts";

describe("itemTableHeaderClassName", () => {
  it("merges select padding so only px-2 remains", () => {
    const className = itemTableHeaderClassName("select");
    assert.match(className, /\bw-10\b/);
    assert.match(className, /\bpx-2\b/);
    assert.doesNotMatch(className, /\bpx-3\b/);
  });

  it("right-aligns actions header", () => {
    const className = itemTableHeaderClassName("actions");
    assert.match(className, /\bw-16\b/);
    assert.match(className, /\btext-right\b/);
  });
});

describe("itemTableCellClassName", () => {
  it("allows wrapping for title and tags", () => {
    assert.match(itemTableCellClassName("title"), /\bwhitespace-normal\b/);
    assert.match(itemTableCellClassName("tags"), /\bwhitespace-normal\b/);
  });

  it("merges select padding so only px-2 remains", () => {
    const className = itemTableCellClassName("select");
    assert.match(className, /\bpx-2\b/);
    assert.doesNotMatch(className, /\bpx-3\b/);
  });

  it("keeps actions cell layout classes", () => {
    assert.match(itemTableCellClassName("actions"), /\btext-right\b/);
  });
});
