import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MASONRY_BREAKPOINTS } from "./masonry-breakpoints.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("masonry sacred layout (#660)", () => {
  it("keeps MASONRY_BREAKPOINTS column map", () => {
    assert.equal(MASONRY_BREAKPOINTS.default, 7);
    assert.equal(MASONRY_BREAKPOINTS[768], 2);
    assert.equal(MASONRY_BREAKPOINTS[500], 1);
  });

  it("ItemGridView still mounts react-masonry-css with .my-masonry-grid", () => {
    const source = readFileSync(join(here, "ItemGridView.tsx"), "utf8");
    assert.match(source, /from ["']react-masonry-css["']/);
    assert.match(source, /breakpointCols=\{MASONRY_BREAKPOINTS\}/);
    assert.match(source, /className=["']my-masonry-grid["']/);
    assert.match(source, /columnClassName=["']my-masonry-grid_column["']/);
  });

  it("package.json still depends on react-masonry-css", () => {
    const pkg = JSON.parse(
      readFileSync(join(here, "../../../package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    assert.ok(pkg.dependencies["react-masonry-css"]);
  });
});
