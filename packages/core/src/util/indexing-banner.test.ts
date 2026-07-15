import { describe, expect, it } from "vitest";
import { formatIndexingBannerLabel } from "./indexing-banner.js";

describe("formatIndexingBannerLabel", () => {
  it("shows rebuild copy while schema is rebuilding", () => {
    expect(
      formatIndexingBannerLabel({ status: "rebuilding", progress: null }),
    ).toBe("Пересборка индекса…");
  });

  it("shows storage indexing when running without totals", () => {
    expect(
      formatIndexingBannerLabel({ status: "running", progress: null }),
    ).toBe("Индексация хранилища…");
  });

  it("shows search phase with counts", () => {
    expect(
      formatIndexingBannerLabel({
        status: "running",
        progress: {
          phase: "content",
          processed: 3,
          total: 10,
          skipped: 0,
          patched: 0,
          indexed: 0,
          contentIndexed: 3,
          removed: 0,
        },
      }),
    ).toBe("Индексация поиска… 3/10");
  });
});
