import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  foreignNumberInputValue,
  foreignTextInputValue,
  fromDatetimeLocalInput,
  toDateInputValue,
  toDatetimeLocalInputValue,
} from "./item-detail-inline-editor-helpers.ts";

describe("toDateInputValue", () => {
  it("slices ISO date prefix", () => {
    assert.equal(toDateInputValue("2024-01-02T03:04:05.000Z"), "2024-01-02");
    assert.equal(toDateInputValue("2024-01-02"), "2024-01-02");
  });

  it("returns empty for non-date values", () => {
    assert.equal(toDateInputValue("not-a-date"), "");
    assert.equal(toDateInputValue(12), "");
    assert.equal(toDateInputValue(null), "");
  });
});

describe("toDatetimeLocalInputValue", () => {
  it("keeps first 16 characters when long enough", () => {
    assert.equal(
      toDatetimeLocalInputValue("2024-01-02T03:04:05.000Z"),
      "2024-01-02T03:04",
    );
  });

  it("returns empty when shorter than 16 chars", () => {
    assert.equal(toDatetimeLocalInputValue("2024-01-02"), "");
  });
});

describe("fromDatetimeLocalInput", () => {
  it("throws on empty local value using the provided label", () => {
    assert.throws(
      () => fromDatetimeLocalInput("", "Property due"),
      /Property due: empty datetime not allowed/,
    );
  });

  it("converts local datetime to ISO", () => {
    const iso = fromDatetimeLocalInput("2024-01-02T03:04", "created_at");
    assert.equal(new Date(iso).toISOString(), iso);
  });
});

describe("foreign input coercion", () => {
  it("foreignNumberInputValue prefers numbers and coerces otherwise", () => {
    assert.equal(foreignNumberInputValue(3), 3);
    assert.equal(foreignNumberInputValue("4"), 4);
    assert.equal(foreignNumberInputValue("x"), 0);
  });

  it("foreignTextInputValue stringifies and blanks nullish", () => {
    assert.equal(foreignTextInputValue(null), "");
    assert.equal(foreignTextInputValue(undefined), "");
    assert.equal(foreignTextInputValue(true), "true");
  });
});
