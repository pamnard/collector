import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TagWithCount } from "@collector/core";
import {
  applyAddTagName,
  applyTagRecordUpdate,
  buildTagDisplayNames,
  nextSelectionAfterAdd,
  removeTagFromCatalog,
  removeTagFromSelection,
  renameTagInSelection,
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

describe("removeTagFromSelection / renameTagInSelection", () => {
  it("filters and renames by sameTagName", () => {
    assert.deepEqual(removeTagFromSelection(["Foo", "bar"], "foo"), ["bar"]);
    assert.deepEqual(renameTagInSelection(["Foo", "bar"], "foo", "Baz"), [
      "Baz",
      "bar",
    ]);
  });
});

describe("catalog mutations", () => {
  const tags: TagWithCount[] = [
    {
      id: "1",
      name: "zeta",
      color: null,
      created_at: "2026-01-01T00:00:00.000Z",
      item_count: 2,
    },
    {
      id: "2",
      name: "alpha",
      color: "#fff",
      created_at: "2026-01-02T00:00:00.000Z",
      item_count: 1,
    },
  ];

  it("applyTagRecordUpdate merges fields, preserves item_count, sorts by name", () => {
    const next = applyTagRecordUpdate(tags, "1", {
      id: "1",
      name: "beta",
      color: "#000",
      created_at: "2026-01-03T00:00:00.000Z",
    });
    assert.deepEqual(
      next.map((t) => ({ id: t.id, name: t.name, item_count: t.item_count, color: t.color })),
      [
        { id: "2", name: "alpha", item_count: 1, color: "#fff" },
        { id: "1", name: "beta", item_count: 2, color: "#000" },
      ],
    );
  });

  it("removeTagFromCatalog drops by id", () => {
    assert.deepEqual(
      removeTagFromCatalog(tags, "2").map((t) => t.id),
      ["1"],
    );
  });
});
