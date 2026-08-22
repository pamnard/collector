import { describe, expect, it } from "vitest";
import { formatDerivedCatchUpBannerLabel } from "./derived-catch-up-banner.js";

describe("formatDerivedCatchUpBannerLabel (#767)", () => {
  it("uses a short label for a single job", () => {
    expect(
      formatDerivedCatchUpBannerLabel({
        vaultId: "v1",
        status: "running",
        pending: 0,
        running: 1,
      }),
    ).toBe("Обновление индекса…");
  });

  it("includes total count when multiple jobs are active", () => {
    expect(
      formatDerivedCatchUpBannerLabel({
        vaultId: "v1",
        status: "running",
        pending: 3,
        running: 1,
      }),
    ).toBe("Обновление индекса… 4");
  });
});
