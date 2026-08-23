import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashboardPerfBeginPhase,
  dashboardPerfBeginRun,
  dashboardPerfEndPhase,
  dashboardPerfGetRuns,
  dashboardPerfObserveL1,
  dashboardPerfObserveL3,
  dashboardPerfRunExpectsViewMode,
  isDashboardPerfEnabled,
  setDashboardPerfEnabledForTests,
} from "./dashboard-perf.ts";

describe("dashboard-perf", () => {
  it("is no-op when disabled", () => {
    setDashboardPerfEnabledForTests(false);
    assert.equal(isDashboardPerfEnabled(), false);
    assert.equal(dashboardPerfBeginRun("folder", { viewMode: "grid" }), null);
    assert.equal(dashboardPerfGetRuns().length, 0);
  });

  it("records phases and L levels when enabled", () => {
    setDashboardPerfEnabledForTests(true);
    const runId = dashboardPerfBeginRun("folder", {
      viewMode: "grid",
      folderPath: "inbox",
      scenario: "A-cold",
    });
    assert.ok(runId);
    dashboardPerfBeginPhase(runId, "queryIndex");
    dashboardPerfEndPhase(runId, "queryIndex");
    dashboardPerfObserveL1(runId);
    dashboardPerfObserveL3(runId);

    const runs = dashboardPerfGetRuns();
    assert.equal(runs.length, 1);
    const run = runs[0]!;
    assert.equal(run.kind, "folder");
    assert.equal(run.meta.folderPath, "inbox");
    assert.equal(run.status, "complete");
    assert.ok(run.phases.queryIndex !== undefined);
    assert.ok(run.l1Ms !== null);
    assert.ok(run.l3Ms !== null);
    setDashboardPerfEnabledForTests(false);
  });

  it("aborts previous run when a new one starts", () => {
    setDashboardPerfEnabledForTests(true);
    const first = dashboardPerfBeginRun("folder", { viewMode: "grid" });
    const second = dashboardPerfBeginRun("viewMode", { viewMode: "table" });
    assert.notEqual(first, second);
    const runs = dashboardPerfGetRuns();
    assert.equal(runs[0]!.status, "aborted");
    assert.equal(runs[1]!.status, "running");
    setDashboardPerfEnabledForTests(false);
  });

  it("matches active run view mode for observers", () => {
    setDashboardPerfEnabledForTests(true);
    const runId = dashboardPerfBeginRun("viewMode", { viewMode: "grid" });
    assert.equal(dashboardPerfRunExpectsViewMode(runId, "grid"), true);
    assert.equal(dashboardPerfRunExpectsViewMode(runId, "table"), false);
    setDashboardPerfEnabledForTests(false);
  });
});
