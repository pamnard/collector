import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAddTagName,
  buildTagDisplayNames,
  nextSelectionAfterAdd,
  sameTagName,
  toggleTagSelection,
} from "./tag-picker-helpers.ts";

describe("sameTagName", () => {
  it("compares trimmed case-insensitive names", () => {
    assert.equal(sameTagName(" Foo ", "foo"), true);
    assert.equal(sameTagName("bar", "baz"), false);
  });
});

describe("buildTagDisplayNames", () => {
  it("keeps catalog order and appends unknown selected names", () => {
    assert.deepEqual(buildTagDisplayNames(["alpha", "beta"], ["Beta", "gamma"]), [
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});

describe("toggleTagSelection", () => {
  it("adds trimmed name when absent", () => {
    assert.deepEqual(toggleTagSelection(["a"], " B "), ["a", "B"]);
  });

  it("removes matching name when present", () => {
    assert.deepEqual(toggleTagSelection(["Foo", "bar"], "foo"), ["bar"]);
  });
});

describe("nextSelectionAfterAdd", () => {
  it("returns null for blank input", () => {
    assert.equal(nextSelectionAfterAdd(["a"], "  "), null);
  });

  it("returns same array reference when already selected", () => {
    const selected = ["Foo"];
    assert.equal(nextSelectionAfterAdd(selected, "foo"), selected);
  });

  it("appends new trimmed name", () => {
    assert.deepEqual(nextSelectionAfterAdd(["a"], " b "), ["a", "b"]);
  });
});

describe("applyAddTagName", () => {
  it("does not call onChange when tag is already selected", () => {
    let calls = 0;
    const selected = ["Foo"];
    const shouldClear = applyAddTagName(selected, "foo", () => {
      calls += 1;
    });
    assert.equal(shouldClear, true);
    assert.equal(calls, 0);
  });

  it("calls onChange when tag is new", () => {
    let received: string[] | undefined;
    const shouldClear = applyAddTagName(["a"], " b ", (next) => {
      received = next;
    });
    assert.equal(shouldClear, true);
    assert.deepEqual(received, ["a", "b"]);
  });

  it("keeps input when blank and does not call onChange", () => {
    let calls = 0;
    assert.equal(
      applyAddTagName(["a"], "  ", () => {
        calls += 1;
      }),
      false,
    );
    assert.equal(calls, 0);
  });
});

describe("derived-only catalog (#842)", () => {
  it("helpers module has no catalog mutation exports", async () => {
    const helpers = await import("./tag-picker-helpers.ts");
    assert.equal("applyTagRecordUpdate" in helpers, false);
    assert.equal("removeTagFromCatalog" in helpers, false);
    assert.equal("renameTagInSelection" in helpers, false);
  });
});
