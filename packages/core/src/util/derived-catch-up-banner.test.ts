import { describe, expect, it } from "vitest";
import type { DerivedCatchUpStatus } from "@collector/api";
import { formatDerivedCatchUpBannerLabel } from "./derived-catch-up-banner.js";
import { derivedCatchUpAlertDecision } from "../../../../src/hooks/shell-layout-alerts.ts";

function status(
  overrides: Partial<DerivedCatchUpStatus> &
    Pick<DerivedCatchUpStatus, "status" | "pending" | "running">,
): DerivedCatchUpStatus {
  return {
    vaultId: "v1",
    ...overrides,
  };
}

/**
 * Call-site gate from useShellLayoutAlerts: banner is upserted only while
 * catch-up status is "running".
 */
function catchUpBannerAlertDecision(
  input: Pick<DerivedCatchUpStatus, "status">,
): "upsert" | "dismiss" {
  return derivedCatchUpAlertDecision(input.status === "running");
}

describe("derived catch-up banner decision (status → visible / branch)", () => {
  it("shows the alert while catch-up is running", () => {
    expect(catchUpBannerAlertDecision({ status: "running" })).toBe("upsert");
  });

  it("hides the alert when catch-up is idle", () => {
    expect(catchUpBannerAlertDecision({ status: "idle" })).toBe("dismiss");
  });

  it("pending+running total ≤ 1 shares the short (no count) branch", () => {
    const idleZero = formatDerivedCatchUpBannerLabel(
      status({ status: "idle", pending: 0, running: 0 }),
    );
    const singleRunning = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 0, running: 1 }),
    );
    const singlePending = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 1, running: 0 }),
    );
    const multi = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 3, running: 1 }),
    );

    expect(idleZero).toBe(singleRunning);
    expect(idleZero).toBe(singlePending);
    expect(idleZero).not.toBe(multi);
    expect(idleZero).not.toMatch(/\d/);
  });

  it("pending+running total > 1 selects the count branch from the sum", () => {
    const fourViaMix = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 3, running: 1 }),
    );
    const fourViaPending = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 4, running: 0 }),
    );
    const fourViaRunning = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 0, running: 4 }),
    );
    const five = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 2, running: 3 }),
    );
    const short = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 0, running: 1 }),
    );

    expect(fourViaMix).toBe(fourViaPending);
    expect(fourViaMix).toBe(fourViaRunning);
    expect(fourViaMix).not.toBe(five);
    expect(fourViaMix).not.toBe(short);
    expect(fourViaMix).toMatch(/4/);
    expect(five).toMatch(/5/);
  });

  it("status field does not change the label branch (only pending+running)", () => {
    const running = formatDerivedCatchUpBannerLabel(
      status({ status: "running", pending: 3, running: 1 }),
    );
    const idle = formatDerivedCatchUpBannerLabel(
      status({ status: "idle", pending: 3, running: 1 }),
    );

    expect(idle).toBe(running);
  });
});
