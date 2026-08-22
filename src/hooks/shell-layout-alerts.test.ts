import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashboardErrorAlertDecision,
  dashboardLoadingAlertDecision,
  derivedCatchUpAlertDecision,
  indexingAlertDecision,
  updateAlertDecision,
} from "./shell-layout-alerts.ts";

describe("shell-layout-alerts decisions (#669)", () => {
  it("shows loading while dashboard is loading", () => {
    assert.equal(dashboardLoadingAlertDecision(true), "upsert");
    assert.equal(dashboardLoadingAlertDecision(false), "dismiss");
  });

  it("shows indexing while metadata index is rebuilding", () => {
    assert.equal(indexingAlertDecision(true), "upsert");
    assert.equal(indexingAlertDecision(false), "dismiss");
  });

  it("shows derived catch-up while itemDerivedRefresh jobs are active", () => {
    assert.equal(derivedCatchUpAlertDecision(true), "upsert");
    assert.equal(derivedCatchUpAlertDecision(false), "dismiss");
  });

  it("shows dashboard error only when not yet dismissed", () => {
    assert.equal(dashboardErrorAlertDecision(null, null), "dismiss");
    assert.equal(dashboardErrorAlertDecision("boom", null), "upsert");
    assert.equal(dashboardErrorAlertDecision("boom", "boom"), "dismiss");
    assert.equal(dashboardErrorAlertDecision("other", "boom"), "upsert");
  });

  it("shows update alert when a version is pending", () => {
    assert.equal(updateAlertDecision(null), "dismiss");
    assert.equal(updateAlertDecision("1.2.3"), "upsert");
  });
});
