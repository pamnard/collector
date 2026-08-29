import { describe, expect, it } from "vitest";
import type { IndexSyncProgress } from "../adapters/types.js";
import {
  formatIndexingBannerLabel,
  type IndexBannerStatus,
} from "./indexing-banner.js";
import { indexingAlertDecision } from "../../../../src/hooks/shell-layout-alerts.ts";

function progress(
  overrides: Partial<IndexSyncProgress> &
    Pick<IndexSyncProgress, "phase" | "processed" | "total">,
): IndexSyncProgress {
  return {
    skipped: 0,
    patched: 0,
    indexed: 0,
    contentIndexed: 0,
    removed: 0,
    ...overrides,
  };
}

/**
 * Call-site gate from useShellLayoutAlerts: banner is upserted only while
 * metadata indexing is active (rebuild, or running before metadataReady).
 */
function indexingBannerAlertDecision(input: {
  status: IndexBannerStatus;
  metadataReady: boolean;
}): "upsert" | "dismiss" {
  const isMetadataIndexing =
    input.status === "rebuilding" ||
    (input.status === "running" && !input.metadataReady);
  return indexingAlertDecision(isMetadataIndexing);
}

describe("indexing banner decision (status → visible / branch)", () => {
  it("shows the alert while rebuilding or while running before metadata is ready", () => {
    expect(
      indexingBannerAlertDecision({
        status: "rebuilding",
        metadataReady: false,
      }),
    ).toBe("upsert");
    expect(
      indexingBannerAlertDecision({
        status: "rebuilding",
        metadataReady: true,
      }),
    ).toBe("upsert");
    expect(
      indexingBannerAlertDecision({
        status: "running",
        metadataReady: false,
      }),
    ).toBe("upsert");
  });

  it("hides the alert when idle, done, or running after metadata is ready", () => {
    expect(
      indexingBannerAlertDecision({ status: "idle", metadataReady: true }),
    ).toBe("dismiss");
    expect(
      indexingBannerAlertDecision({ status: "done", metadataReady: true }),
    ).toBe("dismiss");
    expect(
      indexingBannerAlertDecision({
        status: "running",
        metadataReady: true,
      }),
    ).toBe("dismiss");
  });

  it("rebuilding selects the rebuild branch and ignores progress", () => {
    const rebuildAlone = formatIndexingBannerLabel({
      status: "rebuilding",
      progress: null,
    });
    const rebuildWithCounts = formatIndexingBannerLabel({
      status: "rebuilding",
      progress: progress({ phase: "content", processed: 3, total: 10 }),
    });
    const runningContent = formatIndexingBannerLabel({
      status: "running",
      progress: progress({ phase: "content", processed: 3, total: 10 }),
    });

    expect(rebuildAlone).toBe(rebuildWithCounts);
    expect(rebuildAlone).not.toBe(runningContent);
    expect(rebuildAlone).not.toMatch(/\d+\/\d+/);
  });

  it("null progress and non-positive total share the no-totals branch", () => {
    const noProgress = formatIndexingBannerLabel({
      status: "running",
      progress: null,
    });
    const zeroTotal = formatIndexingBannerLabel({
      status: "running",
      progress: progress({ phase: "metadata", processed: 0, total: 0 }),
    });
    const negativeTotal = formatIndexingBannerLabel({
      status: "running",
      progress: progress({ phase: "content", processed: 0, total: -1 }),
    });
    const withTotals = formatIndexingBannerLabel({
      status: "running",
      progress: progress({ phase: "metadata", processed: 2, total: 5 }),
    });

    expect(noProgress).toBe(zeroTotal);
    expect(noProgress).toBe(negativeTotal);
    expect(noProgress).not.toBe(withTotals);
    expect(noProgress).not.toMatch(/\d+\/\d+/);
  });

  it("content phase is a distinct branch from metadata at the same counts", () => {
    const counts = { processed: 3, total: 10 } as const;
    const content = formatIndexingBannerLabel({
      status: "running",
      progress: progress({ phase: "content", ...counts }),
    });
    const metadata = formatIndexingBannerLabel({
      status: "running",
      progress: progress({ phase: "metadata", ...counts }),
    });

    expect(content).not.toBe(metadata);
    expect(content).toContain("3/10");
    expect(metadata).toContain("3/10");
  });

  it("idle and done still format from progress (status only gates rebuild)", () => {
    const running = formatIndexingBannerLabel({
      status: "running",
      progress: progress({ phase: "content", processed: 1, total: 4 }),
    });
    const idle = formatIndexingBannerLabel({
      status: "idle",
      progress: progress({ phase: "content", processed: 1, total: 4 }),
    });
    const done = formatIndexingBannerLabel({
      status: "done",
      progress: progress({ phase: "content", processed: 1, total: 4 }),
    });

    expect(idle).toBe(running);
    expect(done).toBe(running);
  });
});
