import { describe, expect, it } from "vitest";
import {
  buildJobStatsFromRows,
  escapeLikePrefix,
} from "./job-store-query-builders.js";

describe("job-store-query-builders (#793)", () => {
  it("buildJobStatsFromRows aggregates status and byType counts", () => {
    const stats = buildJobStatsFromRows([
      { status: "pending", type: "noop", n: 2 },
      { status: "running", type: "noop", n: 1 },
      { status: "succeeded", type: "importFolder", n: 3 },
      { status: "failed", type: "importFolder", n: 1 },
    ]);
    expect(stats.pending).toBe(2);
    expect(stats.running).toBe(1);
    expect(stats.succeeded).toBe(3);
    expect(stats.failed).toBe(1);
    expect(stats.cancelled).toBe(0);
    expect(stats.byType.noop).toEqual({
      pending: 2,
      running: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(stats.byType.importFolder).toEqual({
      pending: 0,
      running: 0,
      succeeded: 3,
      failed: 1,
      cancelled: 0,
    });
  });

  it("escapeLikePrefix escapes LIKE wildcards for literal prefix cancel (#875)", () => {
    expect(escapeLikePrefix("generateCover:v1:a_b.md:")).toBe(
      "generateCover:v1:a\\_b.md:",
    );
    expect(escapeLikePrefix("x%y\\z")).toBe("x\\%y\\\\z");
  });
});
