import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bumpCoverRefreshGeneration,
  isCoverRefreshGenerationCurrent,
  notePendingCoverRefresh,
  takePendingCoverRefreshesForItems,
} from "./dashboard-cover-refresh.ts";

describe("dashboard cover refresh generation (#856)", () => {
  it("bumps per-item generation so older resolves are stale", () => {
    const generations = new Map<string, number>();
    const first = bumpCoverRefreshGeneration(generations, "a.md");
    const second = bumpCoverRefreshGeneration(generations, "a.md");
    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(isCoverRefreshGenerationCurrent(generations, "a.md", first), false);
    assert.equal(isCoverRefreshGenerationCurrent(generations, "a.md", second), true);
    assert.equal(isCoverRefreshGenerationCurrent(generations, "b.md", 1), false);
  });

  it("defers refresh until the item appears in the list", () => {
    const pending = new Set<string>();
    notePendingCoverRefresh(pending, "Inbox/reel.md");
    assert.deepEqual(takePendingCoverRefreshesForItems(pending, ["other.md"]), []);
    assert.equal(pending.has("Inbox/reel.md"), true);
    assert.deepEqual(
      takePendingCoverRefreshesForItems(pending, ["Inbox/reel.md", "other.md"]),
      ["Inbox/reel.md"],
    );
    assert.equal(pending.has("Inbox/reel.md"), false);
  });
});
