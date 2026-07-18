import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dashboardGridColumnCount } from "./dashboard-column-count.ts";

describe("dashboardGridColumnCount", () => {
  it("uses max-width breakpoints like react-masonry-css", () => {
    assert.equal(dashboardGridColumnCount(400), 1);
    assert.equal(dashboardGridColumnCount(500), 1);
    assert.equal(dashboardGridColumnCount(501), 2);
    assert.equal(dashboardGridColumnCount(768), 2);
    assert.equal(dashboardGridColumnCount(769), 3);
    assert.equal(dashboardGridColumnCount(4000), 7);
  });
});
