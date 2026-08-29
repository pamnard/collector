/**
 * Dashboard perf paint sequencing (#885): drive the same L1/L2/L3 observer
 * order ItemGridView uses. Broken phase order / mid-paint abort / viewMode
 * gate must fail observed run outcomes — not enabled-flag identity alone.
 */
import { useEffect, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  dashboardPerfActiveRunId,
  dashboardPerfBeginPhase,
  dashboardPerfBeginRun,
  dashboardPerfCompleteRunWithoutL3,
  dashboardPerfEndPhase,
  dashboardPerfGetRuns,
  dashboardPerfObserveL1,
  dashboardPerfObserveL2,
  dashboardPerfObserveL3,
  dashboardPerfRecordCoverDecode,
  dashboardPerfRunExpectsViewMode,
  installDashboardPerfBridge,
  setDashboardPerfEnabledForTests,
  type DashboardPerfViewMode,
} from "./dashboard-perf.ts";

afterEach(() => {
  cleanup();
  setDashboardPerfEnabledForTests(false);
});

/**
 * Mirrors ItemGridView mount → layout → cover-decode observers.
 * Paint markers in the DOM are the user-visible stand-in for grid cards.
 */
function GridPerfPaintProbe(props: {
  viewMode: DashboardPerfViewMode;
  coverDecodeCount?: number;
}): ReactElement {
  useEffect(() => {
    const runId = dashboardPerfActiveRunId();
    if (!runId) {
      return;
    }
    dashboardPerfBeginPhase(runId, "gridMount");
    dashboardPerfObserveL1(runId);
    dashboardPerfEndPhase(runId, "gridMount");
    dashboardPerfBeginPhase(runId, "gridLayout");
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        if (!dashboardPerfRunExpectsViewMode(runId, props.viewMode)) {
          return;
        }
        dashboardPerfEndPhase(runId, "gridLayout");
        dashboardPerfObserveL2(runId);
        const decodeN = props.coverDecodeCount ?? 0;
        if (decodeN <= 0) {
          dashboardPerfCompleteRunWithoutL3(runId);
          return;
        }
        for (let i = 0; i < decodeN; i += 1) {
          dashboardPerfRecordCoverDecode(runId, decodeN);
        }
      });
      void raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
    };
  }, [props.viewMode, props.coverDecodeCount]);

  return (
    <div data-testid="grid-perf-paint" data-view={props.viewMode}>
      grid painted
    </div>
  );
}

describe("dashboard-perf paint sequencing (#885)", () => {
  it("disabled: no run is recorded when a paint probe mounts", () => {
    setDashboardPerfEnabledForTests(false);
    render(<GridPerfPaintProbe viewMode="grid" />);
    expect(screen.getByTestId("grid-perf-paint")).toBeInTheDocument();
    expect(dashboardPerfGetRuns()).toHaveLength(0);
  });

  it("folder cold paint: L1 then L2 then L3 with ordered phase marks", async () => {
    setDashboardPerfEnabledForTests(true);
    installDashboardPerfBridge();

    const runId = dashboardPerfBeginRun("folder", {
      viewMode: "grid",
      folderPath: "inbox",
      scenario: "A-cold",
    });
    expect(runId).toBeTruthy();

    dashboardPerfBeginPhase(runId, "queryIndex");
    dashboardPerfEndPhase(runId, "queryIndex");
    dashboardPerfBeginPhase(runId, "applyIndexPage");
    dashboardPerfEndPhase(runId, "applyIndexPage");
    dashboardPerfBeginPhase(runId, "commitList");
    dashboardPerfEndPhase(runId, "commitList");
    dashboardPerfBeginPhase(runId, "coverFlight");
    dashboardPerfEndPhase(runId, "coverFlight");

    render(<GridPerfPaintProbe viewMode="grid" coverDecodeCount={6} />);
    expect(screen.getByTestId("grid-perf-paint")).toHaveTextContent(
      "grid painted",
    );

    await waitFor(() => {
      const run = dashboardPerfGetRuns().find((row) => row.runId === runId);
      expect(run?.status).toBe("complete");
    });

    const run = dashboardPerfGetRuns().find((row) => row.runId === runId)!;
    expect(run.meta.folderPath).toBe("inbox");
    expect(run.l1Ms).not.toBeNull();
    expect(run.l2Ms).not.toBeNull();
    expect(run.l3Ms).not.toBeNull();
    expect(run.l1Ms!).toBeLessThanOrEqual(run.l2Ms!);
    expect(run.l2Ms!).toBeLessThanOrEqual(run.l3Ms!);
    expect(run.phases.queryIndex).toBeGreaterThanOrEqual(0);
    expect(run.phases.commitList).toBeGreaterThanOrEqual(0);
    expect(run.phases.coverFlight).toBeGreaterThanOrEqual(0);
    expect(run.phases.gridMount).toBeGreaterThanOrEqual(0);
    expect(run.phases.gridLayout).toBeGreaterThanOrEqual(0);
  });

  it("mid-paint abort: first run stays incomplete; second paint completes", async () => {
    setDashboardPerfEnabledForTests(true);

    const first = dashboardPerfBeginRun("folder", { viewMode: "grid" });
    dashboardPerfBeginPhase(first, "queryIndex");
    dashboardPerfEndPhase(first, "queryIndex");
    dashboardPerfObserveL1(first);

    const second = dashboardPerfBeginRun("viewMode", { viewMode: "table" });
    expect(second).not.toBe(first);

    const firstRun = dashboardPerfGetRuns().find((row) => row.runId === first)!;
    expect(firstRun.status).toBe("aborted");
    expect(firstRun.l3Ms).toBeNull();

    // Second run paints under table mode (L1+L2, no cover decode).
    render(<GridPerfPaintProbe viewMode="table" coverDecodeCount={0} />);
    await waitFor(() => {
      const run = dashboardPerfGetRuns().find((row) => row.runId === second);
      expect(run?.status).toBe("complete");
    });

    const secondRun = dashboardPerfGetRuns().find(
      (row) => row.runId === second,
    )!;
    expect(secondRun.l1Ms).not.toBeNull();
    expect(secondRun.l2Ms).not.toBeNull();
    expect(secondRun.l3Ms).toBeNull();
  });

  it("viewMode gate: grid L2 does not complete a table-expecting run", async () => {
    setDashboardPerfEnabledForTests(true);

    const runId = dashboardPerfBeginRun("viewMode", { viewMode: "table" });
    expect(dashboardPerfRunExpectsViewMode(runId, "table")).toBe(true);
    expect(dashboardPerfRunExpectsViewMode(runId, "grid")).toBe(false);

    // Mount a grid probe against a table run — L2/complete must not fire.
    await act(async () => {
      render(<GridPerfPaintProbe viewMode="grid" coverDecodeCount={6} />);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    });

    const run = dashboardPerfGetRuns().find((row) => row.runId === runId)!;
    expect(run.status).toBe("running");
    expect(run.l1Ms).not.toBeNull();
    expect(run.l2Ms).toBeNull();
    expect(run.l3Ms).toBeNull();
    expect(run.phases.gridLayout).toBeUndefined();
  });
});
