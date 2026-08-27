import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldDeferListPaintUntilCovers } from "./dashboard-cold-cover-reveal.ts";

describe("shouldDeferListPaintUntilCovers", () => {
  it("defers list paint only when blocking on covers (cold first window)", () => {
    assert.equal(shouldDeferListPaintUntilCovers(true), true);
    assert.equal(shouldDeferListPaintUntilCovers(false), false);
  });
});
