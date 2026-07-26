import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderPathSegments } from "./folder-path-segments.ts";

describe("folderPathSegments", () => {
  it("splits nested folder paths into cumulative segments", () => {
    assert.deepEqual(folderPathSegments("projects/collector/docs"), [
      { name: "projects", path: "projects" },
      { name: "collector", path: "projects/collector" },
      { name: "docs", path: "projects/collector/docs" },
    ]);
  });

  it("returns empty for blank path", () => {
    assert.deepEqual(folderPathSegments(""), []);
    assert.deepEqual(folderPathSegments("/"), []);
  });
});
